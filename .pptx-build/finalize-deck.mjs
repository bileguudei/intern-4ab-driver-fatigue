import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SKILL_DIR = '/Users/nominganzorig/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations';
const workspaceDir = '/Users/nominganzorig/Desktop/intern-4ab-driver-fatigue';
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);
const finalPath = path.join(workspaceDir, '.pptx-output', 'FatigueGuard-Project-Presentation.pptx');
await fs.mkdir(path.dirname(finalPath), { recursive: true });
const result = await finalizePresentation({
  workspaceDir,
  candidatePath: path.join(workspaceDir, '.codex-finalizer', 'fatigueguard-project-presentation-candidate.pptx'),
  finalPath,
  pythonExecutable: '/Users/nominganzorig/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools', 'inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools', 'inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-bullet-geometry', '--validate-heading-fit'],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: { basis: 'design', families: ['Helvetica Neue'] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(workspaceDir, '.codex-finalizer', 'FatigueGuard-Project-Presentation.validation.json'),
});
console.log(JSON.stringify(result, null, 2));
