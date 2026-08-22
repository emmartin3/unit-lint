#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { lintText, type Finding } from './lint.js';

function printHuman(findings: Finding[]): void {
  let currentFile = '';
  for (const finding of findings) {
    if (finding.file !== currentFile) {
      currentFile = finding.file;
      console.log(currentFile);
    }
    console.log(
      `  ${finding.line}:${finding.column}  ${finding.severity.padEnd(7)} ${finding.rule}  ${finding.message}`
    );
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.length - errorCount;
  console.log('');
  console.log(`${findings.length} problem(s)  (${errorCount} error, ${warningCount} warning)`);
}

function main(argv: string[]): number {
  const jsonOutput = argv.includes('--json');
  const files = argv.filter((arg) => arg !== '--json');

  if (files.length === 0) {
    console.error('usage: unit-lint [--json] <file...>');
    return 1;
  }

  const allFindings: Finding[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`unit-lint: could not read ${file}: ${(err as Error).message}`);
      return 1;
    }
    allFindings.push(...lintText(file, text));
  }

  if (jsonOutput) {
    console.log(JSON.stringify(allFindings, null, 2));
  } else if (allFindings.length === 0) {
    console.log('no problems found');
  } else {
    printHuman(allFindings);
  }

  return allFindings.some((f) => f.severity === 'error') ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
