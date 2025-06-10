#!/usr/bin/env node
// figma-to-react-cli.ts
// CLI tool to extract Figma design and generate React (MUI/Tailwind) components using OpenAI

import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import inquirer from 'inquirer';

// Load environment variables
dotenv.config();

interface FigmaNode {
  name: string;
  type: string;
  children?: FigmaNode[];
}

interface FigmaResponse {
  document: {
    children: FigmaNode[];
  };
}

interface GeneratedComponent {
  name: string;
  code: string;
}

// Load environment variables with type checking
const FIGMA_API_KEY = process.env.FIGMA_API_KEY as string;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY2 as string;
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'generated';

if (!FIGMA_API_KEY || !OPENAI_API_KEY) {
  throw new Error('Missing required environment variables: FIGMA_API_KEY and OPENAI_API_KEY2');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function fetchFigmaFile(fileId: string): Promise<FigmaResponse> {
  const response = await axios.get(`https://api.figma.com/v1/files/${fileId}`, {
    headers: {
      'X-Figma-Token': FIGMA_API_KEY,
    },
  });
  return response.data;
}

function extractNodeSummary(node: FigmaNode, level: number = 0): string {
  let summary = `${'  '.repeat(level)}- ${node.name} (${node.type})\n`;
  if (node.children) {
    for (const child of node.children) {
      summary += extractNodeSummary(child, level + 1);
    }
  }
  return summary;
}

async function generateCode(prompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a code generator that writes production-ready React components with TypeScript, MUI and Tailwind CSS.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.2,
  });
  return completion.choices[0].message.content;
}

function buildPrompt(componentName: string, structureText: string, styleFramework: 'Tailwind CSS' | 'MUI'): string {
  return `Generate a production-ready React functional component with TypeScript named ${componentName}.
Use ${styleFramework} for styling.
Include proper type definitions and interfaces.
Here is the design structure:

${structureText}`;
}

async function ensureOutputDirectory(baseDir: string): Promise<string> {
  const outputPath = path.resolve(process.cwd(), baseDir);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  return outputPath;
}

async function run(): Promise<void> {
  const { fileId, componentName, styleFramework } = await inquirer.prompt([
    {
      type: 'input',
      name: 'fileId',
      message: 'Enter your Figma File ID:',
    },
    {
      type: 'input',
      name: 'componentName',
      message: 'Enter the component name to generate:',
    },
    {
      type: 'list',
      name: 'styleFramework',
      message: 'Choose a styling framework:',
      choices: ['Tailwind CSS', 'MUI'] as const,
    },
  ]);

  console.log('Fetching design...');
  const fileData = await fetchFigmaFile(fileId);

  const mainFrame = fileData.document.children[0];
  const structureText = extractNodeSummary(mainFrame);

  const prompt = buildPrompt(componentName, structureText, styleFramework);

  console.log('Generating code from OpenAI...');
  const code = await generateCode(prompt);

  const outputDir = await ensureOutputDirectory(OUTPUT_DIR);
  const outputPath = path.join(outputDir, `${componentName}.tsx`);
  
  fs.writeFileSync(outputPath, code);
  console.log(`Component saved to ${outputPath}`);
}

run().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
