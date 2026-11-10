import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { AttachmentPickerResult, BulkUploadResult } from './attachments';
import type { VoiceSettings } from './voice';
import './theme.css';

declare global {
  interface Window {
    host?: {
      gooseUrl: string;
      platform: string;
      workspacePath: string;
      openFile?: (path: string) => Promise<{ ok: boolean; detail?: string }>;
      openWorkspace?: () => Promise<{ ok: boolean; detail?: string }>;
      revealFile?: (path: string) => void;
      renderBriefingPdf?: (request: { html: string; fileName: string }) => Promise<{ ok: boolean; detail?: string; path?: string; base64?: string }>;
      pickChatFiles?: () => Promise<AttachmentPickerResult>;
      pathsOfDroppedFiles?: (files: FileList | File[]) => string[];
      addChatFiles?: (paths: string[]) => Promise<AttachmentPickerResult>;
      readTables?: (path: string) => Promise<{ ok: true; tables: { name: string; table: { columns: string[]; rows: string[][]; truncated: boolean } }[] } | { ok: false; detail: string }>;
      bulkUploadRows?: (request: { path: string; tableIndex: number; url: string; token?: string; batchSize?: number; batchId?: string; startAt?: number }) => Promise<BulkUploadResult>;
      cancelBulkUpload?: () => void;
      onBulkUploadProgress?: (cb: (p: { batch: number; total: number; sentRows: number; totalRows: number }) => void) => () => void;
      setZoomFactor?: (factor: number) => void;
      workStatus?: () => Promise<{ configured: boolean; email: string; source: string }>;
      workSetEmail?: (email: string) => Promise<{ ok: boolean; email?: string; detail?: string }>;
      workCall?: (tool: string, args: Record<string, unknown>) => Promise<{ ok: true; data: any } | { ok: false; error: string }>;
      jobRunsRecord?: (runs: Array<Record<string, unknown>>) => Promise<{ ok: true; data: { received: number; stored: number } } | { ok: false; error: string }>;
      jobRunsList?: (args: Record<string, unknown>) => Promise<{ ok: true; data: { count: number; failed: number; runs: Array<Record<string, unknown>> } } | { ok: false; error: string }>;
      recruitingProposals?: (args: Record<string, unknown>) => Promise<{ ok: true; data: { count: number; proposals: Array<Record<string, unknown>> } } | { ok: false; error: string }>;
      observabilityCall?: (view: string, params: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
      recruitingHireList?: (args: Record<string, unknown>) => Promise<{ ok: true; data: { count: number; requests: Array<Record<string, unknown>> } } | { ok: false; error: string }>;
      onboardingList?: () => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      onboardingHandover?: (id: number, start: string) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      onboardingSet?: (id: number, step: string, status: string, note: string) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingHireRelease?: (id: number) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingHireDecide?: (id: number, decision: 'approve' | 'return' | 'decline', note: string) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingImport?: () => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingCriteria?: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
      recruitingCriterionSet?: (args: Record<string, unknown>) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingCriterionDelete?: (requisition: string, id: string) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingPostings?: (args: { status?: string }) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
      recruitingPostingStep?: (action: 'release' | 'send_back' | 'withdraw', id: number, note: string) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingPostingPublish?: (id: number, channels: string[]) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
      recruitingAssessmentSave?: (requisition: string, record: Record<string, unknown>) => Promise<{ ok: true; data: { saved?: boolean; revision?: number; reviewed?: boolean } } | { ok: false; error: string }>;
      recruitingAssessmentList?: (requisition: string) => Promise<{ ok: true; data: Record<string, unknown>[] } | { ok: false; error: string }>;
      recruitingInterviewSave?: (requisition: string, record: Record<string, unknown>) => Promise<{ ok: true; data: { saved?: boolean; note?: string } } | { ok: false; error: string }>;
      recruitingDecide?: (id: number, decision: 'released' | 'declined', note: string) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
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
      readSkill?: (dir: string) => Promise<string | null>;
      importMcpb?: () => Promise<Record<string, unknown> | null>;
      prepareControlTowerConnector?: () => Promise<Record<string, unknown> | null>;
      prepareConnector?: (id: string) => Promise<Record<string, unknown> | null>;
      listBundledConnectors?: () => Promise<{ id: string; name: string; title: string; description: string; tools: number; needsSetup: boolean }[]>;
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
        back: () => Promise<{ ok: boolean }>;
        forward: () => Promise<{ ok: boolean }>;
        home: () => Promise<{ ok: boolean }>;
        onNavState: (callback: (state: { canGoBack: boolean; canGoForward: boolean; url: string }) => void) => () => void;
        setTheme: (theme: 'light' | 'dark') => Promise<{ ok: boolean }>;
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
      skillPackInfo?: (dir: string) => Promise<{ ok: boolean; detail?: string; files?: { path: string; bytes: number }[]; text?: string }>;
      duplicateSkill?: (dir: string) => Promise<{ ok: boolean; slug?: string; detail?: string }>;
      exportSkill?: (dir: string) => Promise<{ ok: boolean; canceled?: boolean; detail?: string; path?: string; files?: number }>;
      importSkillOpen?: () => Promise<null | { ok: boolean; detail?: string; id?: string; slug?: string; name?: string; description?: string; files?: { path: string; bytes: number }[]; text?: string; exists?: boolean }>;
      importSkillInstall?: (id: string, overwrite: boolean) => Promise<{ ok: boolean; detail?: string; slug?: string; replaced?: boolean; db?: { ok: boolean; detail?: string; version?: number | null } }>;
      skillDbSync?: () => Promise<{ ok: boolean; detail?: string; result?: { installed: string[]; updated: string[]; removed: string[]; skipped: string[] } }>;
      skillDbRegister?: (slug: string) => Promise<{ ok: boolean; detail?: string; version?: number | null }>;
      skillDbGroups?: () => Promise<{ ok: boolean; detail?: string; rows?: Array<{ id: string; name: string; role: string }> }>;
      skillDbRanking?: () => Promise<{ ok: boolean; detail?: string; rows?: Array<{ slug: string; description?: string; installs: number; views: number; devices: number; score: number }> }>;
      ontologyGovernanceSave?: (governance: import('./ontology-manager').Governance) => Promise<{ ok: boolean; detail?: string; governance?: import('./ontology-manager').Governance; state?: 'synced' | 'local' | 'conflict'; rev?: number; by?: string; localCopy?: boolean }>;
      ontologyGovernanceSync?: () => Promise<{ ok: boolean; detail?: string; governance?: import('./ontology-manager').Governance; state?: 'synced' | 'local' | 'conflict'; rev?: number; by?: string; localCopy?: boolean; updated?: boolean }>;
      ontologyCatalog?: () => Promise<import('./ontology-manager').CatalogAnswer>;
      skillDbHealth?: () => Promise<{ ok: boolean; detail?: string; actor?: string; data?: { generatedAt?: string; total?: number; skills?: unknown[] } }>;
      skillDbLifecycle?: (args: { slug: string; action: string; reason?: string; sunsetAt?: string; replacedBy?: string }) => Promise<{ ok: boolean; detail?: string; data?: unknown }>;
      skillDbPromotion?: (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; detail?: string; data?: any }>;
      onSkillsSynced?: (cb: () => void) => () => void;
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
