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

// NEW: Efficient image extraction functions
async function extractAndSaveImages(fileId, nodes, targetPath, componentName) {
  const imageNodes = findImageNodes(nodes);
  if (imageNodes.length === 0) return [];

  console.log(`🖼️  Processing ${imageNodes.length} images...`);
  
  try {
    // Get image URLs from Figma API
    const nodeIds = imageNodes.map(node => node.id).join(',');
    const response = await axios.get(
      `https://api.figma.com/v1/images/${fileId}?ids=${nodeIds}&format=png&scale=2`,
      { 
        headers: { "X-Figma-Token": FIGMA_API_KEY },
        timeout: 30000 // 30 second timeout
      }
    );

    const imageUrls = response.data.images;
    const imageImports = [];

    // Create assets directory
    const assetsDir = path.join(targetPath, 'assets');
    await fs.promises.mkdir(assetsDir, { recursive: true });

    // Process images one by one to avoid memory overload
    for (const [nodeId, imageUrl] of Object.entries(imageUrls)) {
      if (!imageUrl) continue;

      try {
        const node = imageNodes.find(n => n.id === nodeId);
        const imageName = sanitizeComponentName(node.name || `image_${Date.now()}`);
        const fileName = `${imageName}.png`;
        const filePath = path.join(assetsDir, fileName);

        // Download image with streaming to handle large files efficiently
        const imageResponse = await axios.get(imageUrl, { 
          responseType: 'stream',
          timeout: 15000 // 15 second timeout per image
        });

        // Create write stream and pipe data
        const writeStream = fs.createWriteStream(filePath);
        imageResponse.data.pipe(writeStream);

        // Wait for write completion
        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });

        // Add to imports array
        imageImports.push({
          importName: imageName,
          fileName: fileName,
          relativePath: `./assets/${fileName}`,
          nodeId: nodeId,
          nodeName: node.name || 'Unnamed'
        });

        console.log(`  ✓ Saved: ${fileName}`);

        // Force garbage collection hint (if available)
        if (global.gc) {
          global.gc();
        }

      } catch (imageError) {
        console.warn(`  ⚠️  Failed to download image for node ${nodeId}: ${imageError.message}`);
        continue; // Skip this image but continue with others
      }
    }

    console.log(`📸 Successfully saved ${imageImports.length} images`);
    return imageImports;

  } catch (error) {
    console.warn(`Failed to extract images: ${error.message}`);
    return [];
  }
}

function findImageNodes(node, imageNodes = []) {
  if (!node) return imageNodes;

  // Check if node has image fills
  if (node.fills && Array.isArray(node.fills)) {
    const hasImageFill = node.fills.some(fill => fill.type === 'IMAGE');
    if (hasImageFill) {
      imageNodes.push(node);
    }
  }

  // Check for nodes that likely contain images
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') {
    const nodeName = node.name.toLowerCase();
    if (nodeName.includes('image') || nodeName.includes('img') || 
        nodeName.includes('photo') || nodeName.includes('picture') ||
        nodeName.includes('icon') || nodeName.includes('logo')) {
      imageNodes.push(node);
    }
  }

  // Check for component instances that might be images
  if (node.type === 'INSTANCE' || node.type === 'COMPONENT') {
    const nodeName = node.name.toLowerCase();
    if (nodeName.includes('image') || nodeName.includes('icon') || nodeName.includes('logo')) {
      imageNodes.push(node);
    }
  }

  // Recursively check children
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      findImageNodes(child, imageNodes);
    });
  }

  return imageNodes;
}

function extractNodeSummary(node, level = 0) {
  if (!node) return "";
  
  let summary = `${"  ".repeat(level)}- ${node.name || 'Unnamed'} (${node.type || 'Unknown'})\n`;
  
  // Add style information for AI context
  const styleInfo = extractStylesForAI(node, level + 1);
  if (styleInfo) {
    summary += styleInfo;
  }
  
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      summary += extractNodeSummary(child, level + 1);
    });
  }
  return summary;
}

function extractStylesForAI(node, level = 0) {
  if (!node) return "";
  
  let styleInfo = "";
  const indent = "  ".repeat(level);
  
  // Extract text content EXACTLY as in Figma
  if (node.characters) {
    styleInfo += `${indent}// TEXT: "${node.characters}"\n`;
  }
  
  // Extract visual properties for AI context
  if (node.fills && node.fills.length > 0) {
    const fill = node.fills[0];
    if (fill.type === 'SOLID' && fill.color) {
      const color = fill.color;
      const opacity = fill.opacity || 1;
      const rgb = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${opacity})`;
      styleInfo += `${indent}// Background: ${rgb}\n`;
    }
  }
  
  // Extract text styles for AI context
  if (node.style) {
    if (node.style.fontFamily) styleInfo += `${indent}// Font: ${node.style.fontFamily}\n`;
    if (node.style.fontSize) styleInfo += `${indent}// Font Size: ${node.style.fontSize}px\n`;
    if (node.style.fontWeight) styleInfo += `${indent}// Font Weight: ${node.style.fontWeight}\n`;
    if (node.style.textAlignHorizontal) styleInfo += `${indent}// Text Align: ${node.style.textAlignHorizontal}\n`;
  }
  
  // Extract layout properties for EXACT positioning
  if (node.absoluteBoundingBox) {
    const box = node.absoluteBoundingBox;
    styleInfo += `${indent}// Position: x=${box.x}px, y=${box.y}px\n`;
    styleInfo += `${indent}// Dimensions: ${box.width}px × ${box.height}px\n`;
  }
  
  // Extract spacing and layout constraints
  if (node.constraints) {
    styleInfo += `${indent}// Constraints: ${JSON.stringify(node.constraints)}\n`;
  }
  
  // Extract padding and margins if available
  if (node.paddingLeft || node.paddingRight || node.paddingTop || node.paddingBottom) {
    styleInfo += `${indent}// Padding: ${node.paddingTop || 0}px ${node.paddingRight || 0}px ${node.paddingBottom || 0}px ${node.paddingLeft || 0}px\n`;
  }
  
  // Extract corner radius for AI context
  if (node.cornerRadius !== undefined) {
    styleInfo += `${indent}// Border Radius: ${node.cornerRadius}px\n`;
  }
  
  // Extract layout mode for flex/grid layouts
  if (node.layoutMode) {
    styleInfo += `${indent}// Layout Mode: ${node.layoutMode}\n`;
    if (node.itemSpacing) styleInfo += `${indent}// Item Spacing: ${node.itemSpacing}px\n`;
    if (node.paddingLeft !== undefined) styleInfo += `${indent}// Padding: ${node.paddingTop}px ${node.paddingRight}px ${node.paddingBottom}px ${node.paddingLeft}px\n`;
    if (node.primaryAxisAlignItems) styleInfo += `${indent}// Main Axis: ${node.primaryAxisAlignItems}\n`;
    if (node.counterAxisAlignItems) styleInfo += `${indent}// Cross Axis: ${node.counterAxisAlignItems}\n`;
  }
  
  return styleInfo;
}

function buildPrompt(componentName, structure, framework) {
  return `Create a pixel-perfect React component named ${componentName}.
- Use ${framework} EXCLUSIVELY for all styling - no CSS modules, no external stylesheets
- Match the exact dimensions, colors, fonts, and spacing from the Figma design
- Use the framework's responsive design features appropriately
- Add strong TypeScript types for props and events
- Implement modern, accessible component structure
- Follow React best practices and accessibility guidelines
- Make it production-ready with proper error handling

CRITICAL: All visual styling must be done using ${framework} components/utilities only.

Here's the detailed component structure with visual properties:

${structure}

Create a component that matches this design exactly using ${framework}.`;
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

// UPDATED: generateWithAI function with image support and framework-only styling
async function generateWithAI(model, client, prompts, outputDir, componentName, imageImports = [], framework = "") {
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

    // Create image imports context for AI
  const imageContext = imageImports.length > 0 
    ? `\n\nAvailable images in assets folder:\n${imageImports.map(img => 
        `// ${img.nodeName} -> import ${img.importName} from '${img.relativePath}';`
      ).join('\n')}\n\nUse these images appropriately in your component JSX.`
    : '';

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

    // Generate component with image awareness
    const compContent = await runPrompt([
      systemMsg,
      {
        role: "user",
        content: `${prompts.componentPrompt}${imageContext}
        
CRITICAL: Output ONLY the raw TypeScript/React code. No markdown fences, no comments, no explanations.
File path: components/${sanitizedName}/${sanitizedName}.tsx
Import types from './types/types' and hook from './hooks/use${sanitizedName}'.
Component name: ${sanitizedName}
Use ${prompts.framework} EXCLUSIVELY for styling - no CSS modules or external stylesheets.
${imageImports.length > 0 ? '\nImport and use the available images in your component JSX where they make sense.' : ''}`,
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

    // NEW: Extract and save images BEFORE generating other files
    console.log("🖼️  Extracting and saving images...");
    const imageImports = await extractAndSaveImages(
      fileId.trim(), 
      mainFrame, 
      compPath, 
      sanitizedName
    );

    if (imageImports.length > 0) {
      console.log(`📸 Successfully processed ${imageImports.length} images`);
    } else {
      console.log("ℹ️  No images found or extracted from this design");
    }

    // 6. Install dependencies
    console.log("📦 Checking dependencies...");
    await checkAndInstallDeps(frameworks);

    // 7. Generate component files with framework-based styling
    console.log("🤖 Generating React component...");
    const styleUsed = frameworks.join(" and ");
    const prompt = buildPrompt(sanitizedName, structureText, styleUsed);
    
    // UPDATED: Pass imageImports and framework to generateWithAI
    const filesPath = await generateWithAI(
      model,
      aiClient,
      { componentPrompt: prompt, framework: styleUsed },
      validatedTargetFolder,
      componentName,
      imageImports, // Pass image imports
      styleUsed // Pass framework info
    );

    console.log(`\n✨ Component generated successfully!`);
    console.log(`📁 Location: ${filesPath}`);
    console.log(`🎯 Component name: ${sanitizedName}`);
    console.log(`💄 Styling: ${styleUsed} (pixel-perfect)`);
    if (imageImports.length > 0) {
      console.log(`🖼️  Images: ${imageImports.length} images saved in assets/`);
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

run();