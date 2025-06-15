import path from "path";
import fs from "fs";
import inquirer from "inquirer";
import dotenv from "dotenv";
dotenv.config();

const FRAMEWORK_DEP_MAP = {
  MUI: {
    dependencies: [
      "@mui/material",
      "@mui/icons-material",
      "@emotion/react",
      "@emotion/styled",
    ],
    devDependencies: [],
  },
  Tailwind: {
    dependencies: [],
    devDependencies: ["tailwindcss", "postcss", "autoprefixer"],
  },
};

const PACKAGE_JSON_PATH =
  path.join(process.env.OUTPUT_DIR || ".", process.env.PACKAGE_JSON_PATH || "package.json");

async function execCommand(cmd) {
  const { exec } = await import("child_process");
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(stderr);
      resolve(stdout);
    });
  });
}

export async function checkAndInstallDeps(frameworks) {
  const pkgPath = path.resolve(PACKAGE_JSON_PATH);
  let pkg = {};

  try {
    if (!fs.existsSync(pkgPath)) {
      console.error("❌ package.json not found at", pkgPath);
      return;
    }

    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (err) {
    console.error("❌ Failed to parse package.json:", err.message);
    return;
  }

  const existingDeps = pkg.dependencies || {};
  const existingDevDeps = pkg.devDependencies || {};

  const missingDeps = [];
  const missingDevDeps = [];

  for (const framework of frameworks) {
    const config = FRAMEWORK_DEP_MAP[framework];
    if (!config) continue;

    for (const dep of config.dependencies) {
      if (!existingDeps[dep] && !existingDevDeps[dep]) {
        missingDeps.push(dep);
      }
    }

    for (const devDep of config.devDependencies) {
      if (!existingDeps[devDep] && !existingDevDeps[devDep]) {
        missingDevDeps.push(devDep);
      }
    }
  }

  if (!missingDeps.length && !missingDevDeps.length) {
    console.log("✅ All required dependencies are already installed.");
    return;
  }

  console.log("\n📦 Missing dependencies:");
  if (missingDeps.length) console.log("  ➤ Dependencies:", missingDeps.join(", "));
  if (missingDevDeps.length) console.log("  ➤ DevDependencies:", missingDevDeps.join(", "));

  const { install } = await inquirer.prompt([
    {
      type: "confirm",
      name: "install",
      message: "Do you want to install the missing dependencies?",
      default: true,
    },
  ]);

  if (!install) {
    console.warn("⚠️ Skipped installation.");
    return;
  }

  try {
    if (missingDeps.length) {
      console.log(`📥 Installing: ${missingDeps.join(" ")}`);
      await execCommand(`npm install ${missingDeps.join(" ")}`);
    }

    if (missingDevDeps.length) {
      console.log(`📥 Installing dev: ${missingDevDeps.join(" ")}`);
      await execCommand(`npm install -D ${missingDevDeps.join(" ")}`);
    }

    console.log("✅ All missing dependencies have been installed.");
  } catch (err) {
    console.error("❌ Installation failed:", err);
  }
}
