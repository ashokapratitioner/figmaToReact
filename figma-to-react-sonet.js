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
  path.join(process.env.OUTPUT_DIR || ".", process.env.OUTPUT_COMPONENT_DIR || "generated");

// Utility functions
function sanitizeComponentName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '').replace(/^[^a-zA-Z]/, 'Component');
}

function validatePath(inputPath) {
  // Simply normalize the path without restricting to current directory
  return path.resolve(path.normalize(inputPath));
}

function getApiKey(model) {
  const keys = {
    OpenAI: process.env.OPENAI_API_KEY,
    Claude: process.env.CLAUDE_API_KEY,
  };
  return keys[model] || null;
}

async function fetchFigmaFile(fileId) {
  try {
    const response = await axios.get(`https://api.figma.com/v1/files/${fileId}`, {
      headers: { "X-Figma-Token": FIGMA_API_KEY }
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 403) {
      throw new Error('Invalid Figma API key or insufficient permissions');
    } else if (error.response?.status === 404) {
      throw new Error('Figma file not found');
    }
    throw new Error(`Failed to fetch Figma file: ${error.message}`);
  }
}

function extractNodeSummary(node, level = 0) {
  if (!node) return "";
  
  let summary = `${"  ".repeat(level)}- ${node.name || 'Unnamed'} (${node.type || 'Unknown'})\n`;
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      summary += extractNodeSummary(child, level + 1);
    });
  }
  return summary;
}

function extractStyles(node, className = "") {
  if (!node) return "";
  
  let styles = "";
  
  // Extract actual Figma properties
  if (node.fills && node.fills.length > 0) {
    const fill = node.fills[0];
    if (fill.type === 'SOLID' && fill.color) {
      const color = fill.color;
      const opacity = fill.opacity || 1;
      const rgb = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${opacity})`;
      
      styles += `${className ? `.${className}` : ""} {\n`;
      styles += `  background-color: ${rgb};\n`;
    }
  }
  
  // Extract text styles
  if (node.style) {
    styles += `${className ? `.${className}` : ""} {\n`;
    if (node.style.fontFamily) styles += `  font-family: "${node.style.fontFamily}";\n`;
    if (node.style.fontSize) styles += `  font-size: ${node.style.fontSize}px;\n`;
    if (node.style.fontWeight) styles += `  font-weight: ${node.style.fontWeight};\n`;
    if (node.style.lineHeightPx) styles += `  line-height: ${node.style.lineHeightPx}px;\n`;
    if (node.style.letterSpacing) styles += `  letter-spacing: ${node.style.letterSpacing}px;\n`;
    if (node.style.textAlignHorizontal) {
      const align = node.style.textAlignHorizontal.toLowerCase();
      styles += `  text-align: ${align};\n`;
    }
    styles += "}\n\n";
  }
  
  // Extract dimensions and layout
  if (node.absoluteBoundingBox) {
    const box = node.absoluteBoundingBox;
    styles += `${className ? `.${className}` : ""} {\n`;
    styles += `  width: ${box.width}px;\n`;
    styles += `  height: ${box.height}px;\n`;
    styles += "}\n\n";
  }
  
  // Extract corner radius
  if (node.cornerRadius) {
    styles += `${className ? `.${className}` : ""} {\n`;
    styles += `  border-radius: ${node.cornerRadius}px;\n`;
    styles += "}\n\n";
  }
  
  // Process children
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      const childClass = (child.name || 'element').toLowerCase().replace(/[^a-z0-9]/g, "-");
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
- Follow React best practices and accessibility guidelines.

Here's the component structure:

${structure}`;
}

async function safeWriteFile(filePath, content) {
  try {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    // Clean the content to remove markdown fences and explanatory text
    const cleanedContent = cleanGeneratedCode(content);
    await fs.promises.writeFile(filePath, cleanedContent, 'utf8');
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error.message}`);
  }
}

function cleanGeneratedCode(content) {
  // Remove markdown code fences
  let cleaned = content.replace(/```[a-z]*\n?/g, '');
  cleaned = cleaned.replace(/```\n?/g, '');
  
  // Remove explanatory text before the actual code
  // Look for import statements or export statements as indicators of actual code
  const codeStart = cleaned.search(/(^|\n)(import|export|interface|type|const|function|class)/m);
  if (codeStart > 0) {
    cleaned = cleaned.substring(codeStart).trim();
  }
  
  // Remove trailing explanatory text after the last meaningful code line
  const lines = cleaned.split('\n');
  let lastCodeLine = -1;
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !line.startsWith('//') && !line.match(/^(This|Required|Note:|The)/)) {
      lastCodeLine = i;
      break;
    }
  }
  
  if (lastCodeLine >= 0) {
    cleaned = lines.slice(0, lastCodeLine + 1).join('\n');
  }
  
  return cleaned.trim();
}

async function generateWithAI(model, client, prompts, outputDir, componentName) {
  const sanitizedName = sanitizeComponentName(componentName);
  const basePath = validatePath(path.join(outputDir, sanitizedName));
  
  const dirs = {
    types: path.join(basePath, "types"),
    hooks: path.join(basePath, "hooks"),
  };

  // Create directories
  for (const dir of Object.values(dirs)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const runPrompt = async (prompt) => {
    try {
      if (model === "OpenAI") {
        const result = await client.chat.completions.create({
          model: "gpt-4o-mini", // Fixed model name
          messages: prompt,
          temperature: 0.2,
          max_tokens: 2048,
        });
        return result.choices[0].message.content;
      } else if (model === "Claude") {
        const result = await client.messages.create({
          model: "claude-3-5-sonnet-20241022", // Use latest available
          max_tokens: 4096,
          messages: prompt.filter(msg => msg.role !== 'system'), // Claude handles system separately
          system: systemPrompts, // Use your imported system prompts directly
        });
        return result.content[0].text;
      }
    } catch (error) {
      throw new Error(`AI generation failed: ${error.message}`);
    }
  };

  const systemMsg = { role: "system", content: systemPrompts };

  try {
    // Generate types
    const typesContent = await runPrompt([
      systemMsg,
      {
        role: "user",
        content: `Create TypeScript types for a component called ${sanitizedName}. 
        
CRITICAL: Output ONLY the raw TypeScript code. No markdown, no comments, no explanations.
File path: components/${sanitizedName}/types.ts
Include proper prop interfaces and event handlers following the system prompt guidelines.`,
      },
    ]);

    // Generate hooks
    const hooksContent = await runPrompt([
      systemMsg,
      {
        role: "user",
        content: `Create a use${sanitizedName} custom hook with business logic only.
        
CRITICAL: Output ONLY the raw TypeScript code. No markdown, no comments, no explanations.
File path: components/${sanitizedName}/use${sanitizedName}.ts
Follow all custom hook generation principles from the system prompt: type-safe, error handling, pure logic only, JSDoc documentation.`,
      },
    ]);

    // Generate component
    const compContent = await runPrompt([
      systemMsg,
      {
        role: "user",
        content: `${prompts.componentPrompt}
        
CRITICAL: Output ONLY the raw TypeScript/React code. No markdown fences, no comments, no explanations.
File path: components/${sanitizedName}/${sanitizedName}.tsx
Import types from './types' and hook from './use${sanitizedName}'.
Use CSS Modules: import styles from './${sanitizedName}.module.scss'
Component name: ${sanitizedName}`,
      },
    ]);

    // Write files safely
    await safeWriteFile(
      path.join(dirs.types, `types.ts`),
      typesContent
    );
    await safeWriteFile(
      path.join(dirs.hooks, `use${sanitizedName}.ts`),
      hooksContent
    );
    await safeWriteFile(
      path.join(basePath, `${sanitizedName}.tsx`),
      compContent
    );

    return basePath;
  } catch (error) {
    throw new Error(`Code generation failed: ${error.message}`);
  }
}

async function run() {
  try {
    console.log("🚀 Figma to React Component Generator\n");

    // 1. Select Model
    const { model } = await inquirer.prompt([
      {
        type: "list",
        name: "model",
        message: "Choose AI model:",
        choices: ["OpenAI", "Claude"],
      },
    ]);

    const apiKey = getApiKey(model);
    if (!apiKey) {
      console.error(`❌ Missing ${model} API Key in .env file`);
      process.exit(1);
    }

    const aiClient =
      model === "OpenAI" ? new OpenAI({ apiKey }) : new Anthropic({ apiKey });

    // 2. Get Figma File ID
    const { fileId } = await inquirer.prompt([
      { 
        type: "input", 
        name: "fileId", 
        message: "Enter Figma File ID:",
        validate: (input) => input.trim().length > 0 || "File ID is required"
      },
    ]);

    console.log("📡 Fetching Figma file...");
    const fileData = await fetchFigmaFile(fileId.trim());
    
    if (!fileData.document?.children?.[0]) {
      throw new Error("Invalid Figma file structure");
    }

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

    const validatedTargetFolder = validatePath(targetFolder);
    await fs.promises.mkdir(validatedTargetFolder, { recursive: true });

    // 4. Framework selection
    const { frameworks } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "frameworks",
        message: "Choose style frameworks:",
        choices: ["MUI", "Tailwind", "Styled Components"],
        validate: (choices) => choices.length > 0 || "Choose at least one framework.",
      },
    ]);

    // 5. Component name and validation
    const { componentName } = await inquirer.prompt([
      { 
        type: "input", 
        name: "componentName", 
        message: "Enter Component Name:",
        validate: (input) => {
          if (!input.trim()) return "Component name is required";
          if (!/^[A-Za-z][A-Za-z0-9]*$/.test(input.trim())) {
            return "Component name must start with a letter and contain only letters and numbers";
          }
          return true;
        }
      },
    ]);

    const sanitizedName = sanitizeComponentName(componentName.trim());
    const compPath = path.join(validatedTargetFolder, sanitizedName);

    if (fs.existsSync(compPath)) {
      const { overwrite } = await inquirer.prompt([
        {
          type: "confirm",
          name: "overwrite",
          message: `Component '${sanitizedName}' already exists. Overwrite?`,
          default: false,
        },
      ]);
      if (!overwrite) {
        console.log("Operation cancelled.");
        process.exit(0);
      }
    }

    // 6. Generate SCSS
    console.log("🎨 Extracting styles...");
    const scss = extractStyles(mainFrame, sanitizedName.toLowerCase());
    const scssPath = path.join(compPath, `${sanitizedName}.module.scss`);
    
    await fs.promises.mkdir(compPath, { recursive: true });
    await safeWriteFile(scssPath, scss);

    // 7. Install dependencies
    console.log("📦 Checking dependencies...");
    await checkAndInstallDeps(frameworks);

    // 8. Generate component and test files
    console.log("🤖 Generating React component...");
    const styleUsed = frameworks.join(" and ");
    const prompt = buildPrompt(sanitizedName, structureText, styleUsed);
    
    const filesPath = await generateWithAI(
      model,
      aiClient,
      { componentPrompt: prompt },
      validatedTargetFolder,
      componentName
    );

    // Generate test file separately
    console.log("🧪 Generating test file...");
    const testContent = await aiClient.messages ? 
      await aiClient.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: `Create a Jest + React Testing Library test file for the ${sanitizedName} component.
          
CRITICAL: Output ONLY the raw TypeScript test code. No markdown, no comments, no explanations.
File path: components/${sanitizedName}/${sanitizedName}.test.tsx
NEVER import custom theme files like '../../theme'.
Use MUI's createTheme() if theme is needed for testing.
Test accessibility, user interactions, and component rendering.`
        }],
        system: systemPrompts
      }).then(result => result.content[0].text) :
      await aiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompts },
          {
            role: "user", 
            content: `Create a Jest + React Testing Library test file for the ${sanitizedName} component.
            
CRITICAL: Output ONLY the raw TypeScript test code. No markdown, no comments, no explanations.
File path: components/${sanitizedName}/${sanitizedName}.test.tsx
NEVER import custom theme files like '../../theme'.
Use MUI's createTheme() if theme is needed for testing.
Test accessibility, user interactions, and component rendering.`
          }
        ]
      }).then(result => result.choices[0].message.content);

    await safeWriteFile(
      path.join(filesPath, `${sanitizedName}.test.tsx`),
      testContent
    );

    console.log(`\n✨ Component generated successfully!`);
    console.log(`📁 Location: ${filesPath}`);
    console.log(`🎯 Component name: ${sanitizedName}`);
    console.log(`💄 Styles: ${styleUsed}`);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

run();