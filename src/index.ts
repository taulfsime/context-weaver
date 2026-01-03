#!/usr/bin/env node

/**
 * AI Context Optimizer - Intelligently select relevant files for AI requests
 */

import * as fs from 'fs';
import * as path from 'path';

interface FileInfo {
  path: string;
  size: number;
  extension: string;
  imports: Set<string>;
  relevanceScore: number;
  content: string;
}

interface ContextConfig {
  maxTokens?: number;
  minFiles?: number;
  maxFileSize?: number;
  contextFiles?: string[];
}

interface ContextOutput {
  query: string;
  files: Array<{
    path: string;
    relevanceScore: number;
    size: number;
    extension: string;
  }>;
  totalSize: number;
  estimatedTokens: number;
}

class ContextOptimizer {
  private rootPath: string;
  private files: Map<string, FileInfo> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();

  private static readonly IGNORE_PATTERNS = new Set([
    'node_modules',
    '.git',
    '__pycache__',
    '.venv',
    'venv',
    'dist',
    'build',
    '.next',
    '.pytest_cache',
    'coverage',
    '.DS_Store',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ]);

  private static readonly IGNORE_EXTENSIONS = new Set([
    '.pyc',
    '.pyo',
    '.so',
    '.dylib',
    '.dll',
    '.exe',
    '.bin',
    '.lock',
  ]);

  private static readonly CODE_EXTENSIONS = new Set([
    '.py',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.java',
    '.cpp',
    '.c',
    '.h',
    '.hpp',
    '.cs',
    '.go',
    '.rs',
    '.rb',
    '.php',
    '.swift',
    '.kt',
    '.sql',
    '.sh',
    '.bash',
    '.yaml',
    '.yml',
    '.json',
    '.toml',
    '.md',
    '.vue',
    '.svelte',
  ]);

  constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
  }

  private shouldIgnore(filePath: string): boolean {
    const parts = filePath.split(path.sep);
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    for (const pattern of ContextOptimizer.IGNORE_PATTERNS) {
      if (parts.some((part) => part === pattern || part.includes(pattern))) {
        return true;
      }
    }

    if (ContextOptimizer.IGNORE_EXTENSIONS.has(ext)) {
      return true;
    }

    if (
      fileName.startsWith('.') &&
      !fileName.match(/^\.(env|gitignore|eslintrc|prettierrc)/)
    ) {
      return true;
    }

    return false;
  }

  public async scanProject(
    maxFileSize: number = 1_000_000,
  ): Promise<Map<string, FileInfo>> {
    console.log(`Scanning project: ${this.rootPath}`);

    await this.scanDirectory(this.rootPath, maxFileSize);

    console.log(`Found ${this.files.size} relevant files`);
    return this.files;
  }

  private async scanDirectory(
    dirPath: string,
    maxFileSize: number,
  ): Promise<void> {
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      console.warn(`Warning: Could not read directory ${dirPath}:`, error);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (this.shouldIgnore(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, maxFileSize);
      } else if (entry.isFile()) {
        await this.processFile(fullPath, maxFileSize);
      }
    }
  }

  private async processFile(
    filePath: string,
    maxFileSize: number,
  ): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();

    if (!ContextOptimizer.CODE_EXTENSIONS.has(ext)) {
      return;
    }

    try {
      const stats = await fs.promises.stat(filePath);

      if (stats.size > maxFileSize) {
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const relativePath = path.relative(this.rootPath, filePath);
      const imports = this.extractImports(content, ext);

      this.files.set(relativePath, {
        path: relativePath,
        size: stats.size,
        extension: ext,
        imports,
        relevanceScore: 0,
        content,
      });
    } catch (error) {
      console.warn(`Warning: Could not read file ${filePath}:`, error);
    }
  }

  private extractImports(content: string, extension: string): Set<string> {
    const imports = new Set<string>();
    let patterns: RegExp[] = [];

    switch (extension) {
      case '.py':
        patterns = [/from\s+([.\w]+)\s+import/g, /import\s+([.\w]+)/g];
        break;

      case '.js':
      case '.ts':
      case '.jsx':
      case '.tsx':
      case '.vue':
      case '.svelte':
        patterns = [
          /from\s+['"]([^'"]+)['"]/g,
          /require\(['"]([^'"]+)['"]\)/g,
          /import\s+['"]([^'"]+)['"]/g,
          /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
        ];
        break;

      case '.java':
        patterns = [/import\s+([.\w]+);/g];
        break;

      case '.go':
        patterns = [/import\s+['"]([^'"]+)['"]/g];
        break;

      case '.rs':
        patterns = [/use\s+([:\w]+)/g];
        break;

      case '.cpp':
      case '.c':
      case '.h':
      case '.hpp':
        patterns = [/#include\s+[<"]([^>"]+)[>"]/g];
        break;

      default:
        return imports;
    }

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (!match[1]) continue;

        imports.add(match[1]);
      }
    }

    return imports;
  }

  public calculateRelevance(
    query: string,
    contextFiles?: string[],
  ): Map<string, number> {
    const scores = new Map<string, number>();
    const queryLower = query.toLowerCase();
    const queryWords = new Set(queryLower.match(/\w+/g) || []);

    for (const [relativePath, fileInfo] of this.files) {
      let score = 0;

      const filename = path.basename(relativePath).toLowerCase();
      if (Array.from(queryWords).some((word) => filename.includes(word))) {
        score += 10;
      }

      const pathLower = relativePath.toLowerCase();
      const pathMatches = Array.from(queryWords).filter((word) =>
        pathLower.includes(word),
      ).length;
      score += pathMatches * 5;

      const contentLower = fileInfo.content.toLowerCase();
      const contentMatches = Array.from(queryWords).filter((word) =>
        contentLower.includes(word),
      ).length;
      score += contentMatches * 2;

      if (contextFiles?.includes(relativePath)) {
        score += 15;
      }

      if (contextFiles) {
        for (const ctxFile of contextFiles) {
          const ctxFileInfo = this.files.get(ctxFile);
          if (ctxFileInfo) {
            if (
              Array.from(ctxFileInfo.imports).some((imp) =>
                relativePath.includes(imp),
              )
            ) {
              score += 8;
            }
          }
        }
      }

      if (['.md', '.txt'].includes(fileInfo.extension)) {
        score *= 0.5;
      } else if (pathLower.includes('test') || pathLower.includes('spec')) {
        score *= 0.7;
      } else if (
        pathLower.includes('config') ||
        ['.json', '.yaml', '.yml', '.toml'].includes(fileInfo.extension)
      ) {
        score *= 0.8;
      }

      if (
        filename === 'package.json' ||
        filename === 'main.py' ||
        filename === 'index.ts'
      ) {
        score += 5;
      }

      fileInfo.relevanceScore = score;
      scores.set(relativePath, score);
    }

    return scores;
  }

  public getOptimalContext(
    query: string,
    config: ContextConfig = {},
  ): FileInfo[] {
    const { maxTokens = 100000, minFiles = 3, contextFiles = [] } = config;

    this.calculateRelevance(query, contextFiles);

    const sortedFiles = Array.from(this.files.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore,
    );

    const selected: FileInfo[] = [];
    let totalTokens = 0;

    for (const fileInfo of sortedFiles) {
      if (fileInfo.relevanceScore === 0 && selected.length >= minFiles) {
        break;
      }

      const fileTokens = Math.ceil(fileInfo.content.length / 4);

      if (totalTokens + fileTokens <= maxTokens) {
        selected.push(fileInfo);
        totalTokens += fileTokens;
      } else if (selected.length < minFiles) {
        selected.push(fileInfo);
        totalTokens += fileTokens;
      }
    }

    return selected;
  }

  public generateContextSummary(files: FileInfo[]): string {
    let summary = `# Context Summary (${files.length} files)\n\n`;

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalTokens = files.reduce(
      (sum, f) => sum + Math.ceil(f.content.length / 4),
      0,
    );

    summary += `**Total Size:** ${totalSize.toLocaleString()} bytes\n`;
    summary += `**Estimated Tokens:** ${totalTokens.toLocaleString()}\n\n`;

    summary += '## Selected Files:\n';
    for (const f of files.sort((a, b) => b.relevanceScore - a.relevanceScore)) {
      summary += `- \`${f.path}\` (score: ${f.relevanceScore.toFixed(1)})\n`;
    }

    return summary;
  }

  public exportContext(query: string, files: FileInfo[]): ContextOutput {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalTokens = files.reduce(
      (sum, f) => sum + Math.ceil(f.content.length / 4),
      0,
    );

    return {
      query,
      files: files.map((f) => ({
        path: f.path,
        relevanceScore: f.relevanceScore,
        size: f.size,
        extension: f.extension,
      })),
      totalSize,
      estimatedTokens: totalTokens,
    };
  }
}

export {
  ContextOptimizer,
  type FileInfo,
  type ContextConfig,
  type ContextOutput,
};
