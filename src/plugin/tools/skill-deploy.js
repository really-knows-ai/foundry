import path from 'path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

export function writeFoundrySkills(worktree, packageRoot) {
  const sourceDir = resolveSkillsSource(packageRoot);
  if (!sourceDir) {
    return { ok: false, error: 'Skills directory not found in dist/skills or src/skills' };
  }

  const skillDirs = readdirSync(sourceDir, { withFileTypes: true })
    .filter(e => e.isDirectory());

  let count = 0;
  for (const dir of skillDirs) {
    const sourceSkill = path.join(sourceDir, dir.name, 'SKILL.md');
    if (!existsSync(sourceSkill)) continue;
    copySkillFile(worktree, dir.name, sourceSkill);
    count++;
  }

  return { ok: true, count };
}

function resolveSkillsSource(packageRoot) {
  const distSkillsDir = path.join(packageRoot, 'dist', 'skills');
  if (existsSync(distSkillsDir)) return distSkillsDir;
  const srcSkillsDir = path.join(packageRoot, 'src', 'skills');
  if (existsSync(srcSkillsDir)) return srcSkillsDir;
  return null;
}

function copySkillFile(worktree, name, sourcePath) {
  const targetDir = path.join(worktree, '.opencode', 'skills', name);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(path.join(targetDir, 'SKILL.md'), readFileSync(sourcePath, 'utf8'));
}
