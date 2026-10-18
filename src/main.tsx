import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { AttachmentPickerResult } from './attachments';
import type { VoiceSettings } from './voice';
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
      n8n?: {
        getSettings: () => Promise<{ url: string; chatConnected: boolean }>;
        saveSettings: (url: string) => Promise<{ ok: boolean; url?: string; chatConnected?: boolean; detail?: string }>;
        show: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean }>;
        hide: () => Promise<{ ok: boolean }>;
        reload: () => Promise<{ ok: boolean }>;
        connectChat: () => Promise<{ ok: boolean; detail?: string }>;
        disconnectChat: () => Promise<{ ok: boolean; detail?: string }>;
      };
      voice?: {
        getSettings: () => Promise<VoiceSettings>;
        saveSettings: (
          patch: Partial<Omit<VoiceSettings, 'hasKey'>> & { key?: string }
        ) => Promise<{ ok: boolean; settings?: VoiceSettings; detail?: string }>;
        transcribe: (
          audio: ArrayBuffer,
          mimeType: string
        ) => Promise<{ ok: boolean; text?: string; code?: string; detail?: string }>;
      };
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
