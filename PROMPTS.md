# Figma to React Component Generation Prompts

## System Prompts

### Component Generation
```
You are a code generator that writes production-ready React components with MUI and Tailwind CSS.
Your task is to convert Figma design structures into functional, well-structured React components.
Follow these guidelines:

1. Use modern React best practices (functional components, hooks)
2. Include proper TypeScript types when needed
3. Implement responsive design patterns
4. Add proper comments and documentation
5. Follow the specified styling framework conventions (MUI or Tailwind)
```

## User Prompts

### Basic Component Generation
```
Generate a production-ready React functional component named [componentName].
Use [styleFramework] for styling.
Here is the design structure:

[structureText]
```

### Detailed Component Generation
```
Create a React component named [componentName] with the following requirements:

1. Framework: [styleFramework]
2. Design Structure:
[structureText]

Please include:
- Proper prop types/interfaces
- Responsive design considerations
- Loading states
- Error handling
- Accessibility features
```

### Layout Component Generation
```
Generate a layout component named [componentName] using [styleFramework].
This should be a flexible container component that:
- Handles responsive layouts
- Manages spacing and alignment
- Supports nested components
- Implements proper grid system

Design structure:
[structureText]
```

### Form Component Generation
```
Create a form component named [componentName] using [styleFramework].
Requirements:
- Form validation
- Error handling
- Loading states
- Success feedback
- Proper field layouts

Design structure:
[structureText]
```

## Response Format Guidelines

The generated code should:
1. Be properly formatted and indented
2. Include necessary imports
3. Have TypeScript types/interfaces when applicable
4. Include basic unit test examples
5. Have proper JSDoc comments
6. Follow the specified styling framework's best practices
