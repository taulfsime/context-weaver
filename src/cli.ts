import { ContextOptimizer } from "./index.js";
import * as fs from "fs";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: tsx context_optimizer.ts <project_path> [query]');
    console.log('\nExample:');
    console.log(
      '  tsx context_optimizer.ts ./my-project "fix authentication bug"',
    );
    process.exit(1);
  }

  const projectPath = args[0]!;
  const query = args[1] || 'main function';

  console.log(`\nAnalyzing project for query: "${query}"\n`);

  const optimizer = new ContextOptimizer(projectPath);

  await optimizer.scanProject();

  const optimalFiles = optimizer.getOptimalContext(query, {
    maxTokens: 50000,
    minFiles: 3,
  });

  console.log('\n' + '='.repeat(60));
  console.log(optimizer.generateContextSummary(optimalFiles));
  console.log('='.repeat(60));

  const output = optimizer.exportContext(query, optimalFiles);
  const outputFile = 'context_output.json';

  await fs.promises.writeFile(outputFile, JSON.stringify(output, null, 2));

  console.log(`Context saved to: ${outputFile}\n`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
