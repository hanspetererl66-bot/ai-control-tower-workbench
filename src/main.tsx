import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { AttachmentPickerResult } from './attachments';
import './theme.css';

declare global {
  interface Window {
    host?: {
      gooseUrl: string;
      platform: string;
      workspacePath: string;
      openFile?: (path: string) => Promise<{ ok: boolean; detail?: string }>;
      revealFile?: (path: string) => void;
      pickChatFiles?: () => Promise<AttachmentPickerResult>;
      runLocalWorkflow?: (request: {
        type: 'data-space' | 'shipment-deck' | 'meeting-brief-doc';
        csvPath?: string;
        templatePath?: string;
        sourceText?: string;
        sourceName?: string;
        title?: string;
        prompt: string;
        spaceSlug?: string;
      }) => Promise<{
        handled: boolean;
        detail?: string;
        kind?: string;
        slug?: string;
        title?: string;
        text?: string;
        files?: string[];
        toolCalls?: Array<{
          title: string;
          toolName: string;
          status: 'completed' | 'failed';
          locations?: Array<{ path: string }>;
        }>;
      }>;
      onSkillInstallRequest?: (cb: (payload: Record<string, unknown>) => void) => () => void;
      onSkillInstallResult?: (
        cb: (payload: {
          id: number;
          kind?: 'mcp' | 'skill';
          name: string;
          ok: boolean;
          detail: string;
        }) => void
      ) => () => void;
      decideSkillInstall?: (id: number, approved: boolean, values?: Record<string, string>) => void;
      listSkills?: () => Promise<{ name: string; description: string; dir: string }[]>;
      importMcpb?: () => Promise<Record<string, unknown> | null>;
      prepareControlTowerConnector?: () => Promise<Record<string, unknown> | null>;
      getConnectorSpec?: (name: string) => Promise<Record<string, unknown> | null>;
      saveConnectorConfig?: (
        name: string,
        values: Record<string, string>,
        config?: unknown
      ) => Promise<{ ok: boolean; detail?: string }>;
      removeSkill?: (name: string) => Promise<{ ok: boolean; detail?: string }>;
      forgetSecrets?: (name: string) => Promise<{ ok: boolean; detail?: string }>;
      setConnectorEnabled?: (
        name: string,
        enabled: boolean
      ) => Promise<{ ok: boolean; detail?: string }>;
      removeConnector?: (name: string) => Promise<{ ok: boolean; detail?: string }>;
      restartAgent?: () => Promise<{ ok: boolean; detail?: string }>;
    };
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
