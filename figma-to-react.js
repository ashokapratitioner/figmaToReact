#!/usr/bin/env node

import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import inquirer from "inquirer";
import Anthropic from "@anthropic-ai/sdk";
import { systemPrompts } from "./systemPrompts.js";
import { checkAndInstallDeps } from "./framework-depedency.js";

// ENV Variables
const FIGMA_API_KEY = process.env.FIGMA_API_KEY;
const DEFAULT_OUTPUT =
  path.join(process.env.OUTPUT_DIR, process.env.OUTPUT_COMPONENT_DIR) ||
  "generated";

function getApiKey(model) {
  const keys = {
    OpenAI: process.env.OPENAI_API_KEY,
    Claude: process.env.CLAUDE_API_KEY,
  };
  return keys[model] || null;
}

async function fetchFigmaFile(fileId) {
  const response = await axios.get(`https://api.figma.com/v1/files/${fileId}`, {
    headers: { "X-Figma-Token": FIGMA_API_KEY },
  });
  return response.data;
}

function extractNodeSummary(node, level = 0) {
  let summary = `${"  ".repeat(level)}- ${node.name} (${node.type})\n`;
  if (node.children) {
    node.children.forEach((child) => {
      summary += extractNodeSummary(child, level + 1);
    });
  }
  return summary;
}

function extractStyles(node, className = "") {
  let styles = "";
  if (node.style) {
    const s = node.style;
    styles += `${className ? `.${className}` : ""} {\n`;
    if (s.backgroundColor)
      styles += `  background-color: ${s.backgroundColor};\n`;
    if (s.fill) styles += `  color: ${s.fill};\n`;
    if (s.fontFamily) styles += `  font-family: ${s.fontFamily};\n`;
    if (s.fontSize) styles += `  font-size: ${s.fontSize}px;\n`;
    if (s.fontWeight) styles += `  font-weight: ${s.fontWeight};\n`;
    if (s.lineHeight) styles += `  line-height: ${s.lineHeight};\n`;
    if (s.letterSpacing) styles += `  letter-spacing: ${s.letterSpacing}px;\n`;
    if (s.textAlign) styles += `  text-align: ${s.textAlign};\n`;
    if (s.width) styles += `  width: ${s.width}px;\n`;
    if (s.height) styles += `  height: ${s.height}px;\n`;
    if (s.padding) styles += `  padding: ${s.padding}px;\n`;
    if (s.borderRadius) styles += `  border-radius: ${s.borderRadius}px;\n`;
    styles += "}\n\n";
  }
  if (node.children) {
    node.children.forEach((child) => {
      const childClass = child.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
      styles += extractStyles(child, childClass);
    });
  }
  return styles;
}

function buildPrompt(componentName, structure, framework) {
  return `Create a React component named ${componentName}.
- Use ${framework} for styling.
- Add strong TypeScript types for props and events.
- Minimal, modern structure.

Here’s the component structure:

${structure}`;
}

async function generateWithAI(
  model,
  client,
  prompts,
  outputDir,
  componentName
) {
  const basePath = path.join(outputDir, componentName);
  const dirs = {
    types: path.join(basePath, "types"),
    hooks: path.join(basePath, "hooks"),
  };
  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

  const runPrompt = async (prompt) => {
    if (model === "OpenAI") {
      const result = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: prompt,
        temperature: 0.2,
      });
      return result.choices[0].message.content;
    } else if (model === "Claude") {
      const result = await client.messages.create({
        model: "claude-3-sonnet-20240229",
        max_tokens: 2048,
        messages: prompt,
      });
      return result.content[0].text;
    }
  };

  const systemMsg = { role: "system", content: systemPrompts };

  const typesContent = await runPrompt([
    systemMsg,
    {
      role: "user",
      content: `Create TypeScript types for a component called ${componentName}.`,
    },
  ]);
  const hooksContent = await runPrompt([
    systemMsg,
    {
      role: "user",
      content: `Create a use${componentName} custom hook with business logic only.`,
    },
  ]);
  const compContent = await runPrompt([
    systemMsg,
    {
      role: "user",
      content: `${prompts.componentPrompt}. 
    ⚠️ Important rules for code generation:
- The component should go in \`index.tsx\`.
- Do NOT define hooks inside the component. Import them from '../../hooks/use${componentName}'.
- Do NOT define types inside the component. Import from './types/${componentName}.types'.
- Do NOT write or include any SCSS/CSS-in-JS or <style> content in this file. Assume styles are defined externally in './${componentName}.scss'.
- Only include the React component implementation, including imports and JSX.
❌ Do NOT wrap the output in \`\`\`typescript or any markdown code block. I want pure code only.
The file path is: src/components/${componentName}/index.tsx.
`,
    },
  ]);

  fs.writeFileSync(
    path.join(dirs.types, `${componentName}.types.ts`),
    typesContent
  );
  fs.writeFileSync(
    path.join(dirs.hooks, `use${componentName}.ts`),
    hooksContent
  );
  fs.writeFileSync(path.join(basePath, `index.tsx`), compContent);
  return basePath;
}

async function run() {
  // 1. Select Model
  const { model } = await inquirer.prompt([
    {
      type: "list",
      name: "model",
      message: "Choose model:",
      choices: ["OpenAI", "Claude"],
    },
  ]);
  const apiKey = getApiKey(model);
  if (!apiKey) {
    console.error(`Missing ${model} API Key in .env`);
    process.exit(1);
  }
  const aiClient =
    model === "OpenAI" ? new OpenAI({ apiKey }) : new Anthropic({ apiKey });

  // 2. Get Figma File ID
  const { fileId } = await inquirer.prompt([
    { type: "input", name: "fileId", message: "Enter Figma File ID:" },
  ]);
  if(!fileId) {
    console.log("No figmaId provided, exiting program.")
    process.exit(1);
  }
  const fileData = await fetchFigmaFile(fileId);
  const mainFrame = fileData.document.children[0];
  const structureText = extractNodeSummary(mainFrame);

  // 3. Target Folder
  const { targetFolder } = await inquirer.prompt([
    {
      type: "input",
      name: "targetFolder",
      message: "Target folder:",
      default: DEFAULT_OUTPUT,
    },
  ]);
  fs.mkdirSync(targetFolder, { recursive: true });

  // 4. Framework selection
  const { frameworks } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "frameworks",
      message: "Choose style frameworks:",
      choices: ["MUI", "Tailwind"],
      validate: (a) => a.length > 0 || "Choose at least one.",
    },
  ]);

  // 5. TypeScript support
  const { useTS } = await inquirer.prompt([
    {
      type: "confirm",
      name: "useTS",
      message: "Use TypeScript?",
      default: true,
    },
  ]);

  // 6. Component name and overwrite check
  const { componentName } = await inquirer.prompt([
    { type: "input", name: "componentName", message: "Enter Component Name:" },
  ]);
  const compPath = path.join(targetFolder, componentName);
  if (fs.existsSync(compPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: `Component already exists. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) process.exit(0);
  }

  // 7. SCSS extraction
  const scss = extractStyles(mainFrame, componentName.toLowerCase());
  const scssPath = path.join(compPath, `${componentName}.module.scss`);
  fs.mkdirSync(compPath, { recursive: true });
  fs.writeFileSync(scssPath, scss);

  // 8. Prompt and generate code
  const styleUsed = frameworks.join(" and ");
  const prompt = buildPrompt(componentName, structureText, styleUsed);
  await checkAndInstallDeps(frameworks);
  const filesPath = await generateWithAI(
    model,
    aiClient,
    { componentPrompt: prompt },
    targetFolder,
    componentName
  );
  console.log(`\n✨ Now generating files at this path: ${filesPath}`);
  console.log(`\n✅ Generated at: ${filesPath}`);
}

run();
