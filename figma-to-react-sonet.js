#!/usr/bin/env node
// figma-to-react-cli.js
// CLI tool to extract Figma design and generate React (MUI/Tailwind) components using Claude API

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import Anthropic from 'anthropic';
import inquirer from 'inquirer';

// Load environment variables
const FIGMA_API_KEY = process.env.FIGMA_API_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const anthropic = new Anthropic({
  apiKey: CLAUDE_API_KEY,
});

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
  const message = await anthropic.messages.create({
    model: "claude-3-opus-20240229",
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content: "You are a code generator that writes production-ready React components with MUI and Tailwind CSS."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.2,
  });
  return message.content[0].text;
}

function buildPrompt(componentName, structureText, styleFramework) {
  return `Generate a production-ready React functional component named ${componentName}.\nUse ${styleFramework} for styling.\nHere is the design structure:\n\n${structureText}`;
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

  console.log('Generating code from Claude API...');
  const code = await generateCode(prompt);

  const outputPath = path.join(__dirname, `${componentName}.jsx`);
  fs.writeFileSync(outputPath, code);
  console.log(`Component saved to ${outputPath}`);
}

run();
