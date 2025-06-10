#!/usr/bin/env node
// figma-to-react-cli.js
// CLI tool to extract Figma design and generate React (MUI/Tailwind) components using OpenAI

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import inquirer from 'inquirer';

// Load environment variables
const FIGMA_API_KEY = process.env.FIGMA_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY2;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function fetchFigmaFile(fileId) {
  const response = await axios.get(`https://api.figma.com/v1/files/${fileId}`, {
    headers: {
      'X-Figma-Token': FIGMA_API_KEY,
    },
  });
  return response.data;
}

function extractNodeSummary(node, level = 0) {
  let summary = `${'  '.repeat(level)}- ${node.name} (${node.type})\n`;
  if (node.children) {
    for (const child of node.children) {
      summary += extractNodeSummary(child, level + 1);
    }
  }
  return summary;
}

async function generateCode(prompt) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a code generator that writes production-ready React components with TypeScript, including proper type definitions for props and other interfaces. Use MUI or Tailwind CSS for styling.'
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

function buildPrompt(componentName, structureText, styleFramework) {
  return `Generate a production-ready React functional component using TypeScript named ${componentName}.
Component requirements:
- Use ${styleFramework} for styling
- Include TypeScript interfaces for all props
- Add proper type definitions for all variables and functions
- Include JSDoc comments for the component and its props
- Ensure all props are properly typed
- Add type safety for any event handlers
- Include prop validation where necessary

Here is the design structure:

${structureText}`;
}

async function run() {
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
      choices: ['Tailwind CSS', 'MUI'],
    },
  ]);

  console.log('Fetching design...');
  const fileData = await fetchFigmaFile(fileId);

  const mainFrame = fileData.document.children[0];
  const structureText = extractNodeSummary(mainFrame);

  const prompt = buildPrompt(componentName, structureText, styleFramework);

  console.log('Generating code from OpenAI...');
  const code = await generateCode(prompt);

  // Fix the path handling to use process.cwd()
  const outputDir = process.env.OUTPUT_DIR || 'generated';
  const outputPath = path.join(process.cwd(), outputDir, `${componentName}.tsx`);
  
  // Create the generated directory if it doesn't exist
  if (!fs.existsSync(path.join(process.cwd(), outputDir))) {
    fs.mkdirSync(path.join(process.cwd(), outputDir), { recursive: true });
  }

  fs.writeFileSync(outputPath, code);
  console.log(`Component saved to ${outputPath}`);
}

run();
