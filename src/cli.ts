#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { lintText, type Finding, type LintOptions } from './lint.js';

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
  let jsonOutput = false;
  let configPath: string | undefined;
  const files: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--config') {
      configPath = argv[++i];
      if (configPath === undefined) {
        console.error('unit-lint: --config requires a path');
        return 1;
      }
    } else {
      files.push(arg);
    }
  }

  if (files.length === 0) {
    console.error('usage: unit-lint [--json] [--config <file>] <file...>');
    return 1;
  }

  let options: LintOptions = {};
  if (configPath !== undefined) {
    try {
      options = loadConfig(configPath);
    } catch (err) {
      console.error(`unit-lint: ${(err as Error).message}`);
      return 1;
    }
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
    allFindings.push(...lintText(file, text, options));
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
