// The Goose config is local state (connector installs write absolute paths into it),
// so only the template config.example.yaml is checked in. This copies it to
// config.yaml when that file does not exist yet. An existing config.yaml is never touched.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const GOOSE_CONFIG_REL = 'goose-home/.config/goose/config.yaml';
export const GOOSE_CONFIG_TEMPLATE_REL = 'goose-home/.config/goose/config.example.yaml';

/** Returns true when config.yaml was created from the template, false when it already existed. */
export function ensureGooseConfig(root) {
  const target = join(root, GOOSE_CONFIG_REL);
  if (existsSync(target)) return false;
  const template = join(root, GOOSE_CONFIG_TEMPLATE_REL);
  if (!existsSync(template)) throw new Error(`Goose config template is missing: ${GOOSE_CONFIG_TEMPLATE_REL}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(template, target);
  return true;
}
