# Figma to React Component Generator

A CLI tool that converts Figma designs into production-ready React components using AI (OpenAI GPT-4 or Claude). It supports both Material-UI (MUI) and Tailwind CSS styling frameworks.

## Features

- Extract Figma design structure from a file ID
- Generate React components with your choice of styling (MUI or Tailwind CSS)
- Automated component generation using AI
- Support for both OpenAI GPT-4 and Claude AI models

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your API keys:
```
FIGMA_API_KEY=your_figma_api_key
OPENAI_API_KEY=your_openai_api_key  # For GPT-4 version
CLAUDE_API_KEY=your_claude_api_key   # For Claude version
```

## Usage

### Using OpenAI (GPT-4):
```bash
node figma-to-react.js
```

### Using Claude:
```bash
node figma-to-react-sonet.js
```

Follow the interactive prompts:
1. Enter your Figma File ID
2. Enter the component name
3. Choose your styling framework (MUI or Tailwind CSS)

The generated component will be saved as a `.jsx` file in the project directory.

## Environment Variables

- `FIGMA_API_KEY`: Your Figma API access token
- `OPENAI_API_KEY`: Your OpenAI API key (for GPT-4 version)
- `CLAUDE_API_KEY`: Your Anthropic Claude API key (for Claude version)

## Directory Structure

```
.
├── figma-to-react.js      # OpenAI version
├── figma-to-react-sonet.js # Claude version
├── package.json
└── generated/            # Generated components directory
```

## Dependencies

- axios: For Figma API requests
- dotenv: For environment variables
- inquirer: For interactive CLI
- openai: For OpenAI API integration
- anthropic: For Claude API integration
