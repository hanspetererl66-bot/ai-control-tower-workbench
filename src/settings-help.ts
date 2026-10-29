/**
 * Plain-language help for the Settings dialog: what each tab is for, where a change shows up and what it does.
 * Kept as data so the wording can be reviewed in one place and checked by tests (every section has an effect line).
 */
export type TabHelp = { what: string; where: string; effect: string };

export const TAB_HELP: Record<string, TabHelp> = {
  profiles: {
    what: 'A profile is a saved bundle of your settings, for example one for a customer demo and one for daily work.',
    where: 'Look, start view, pinned Spaces, favourite skills and assistant instructions are part of a profile.',
    effect: 'Switching a profile changes all of these at once. Memory, groups and keys are not part of a profile.',
  },
  look: {
    what: 'How the app looks: colours, text size, font, density and accessibility.',
    where: 'Everywhere in this app and in the Spaces, immediately.',
    effect: 'Only the display changes. Your data, Spaces and answers stay the same.',
  },
  work: {
    what: 'How the app starts and which shortcuts you see: start view, pinned Spaces, skills, suggestions and cards.',
    where: 'The Spaces list, the empty chat and the area below the message box.',
    effect: 'Nothing is sent to the assistant. These settings only arrange what you see.',
  },
  assistant: {
    what: 'How the assistant answers: language, length, tone, standing instructions and helpers in the chat window.',
    where: 'Every conversation, also the ones you start later. The panel to the right of the chat shows the same instructions.',
    effect: 'These settings are sent with every message. They never override safety rules or tool permissions.',
  },
  memory: {
    what: 'Short notes the assistant keeps in mind, for example who you are or how you like results.',
    where: 'Every conversation. You can also edit the notes in the Memory tab next to the chat.',
    effect: 'Notes are added to each message while memory is on. Nothing is saved without your OK, and they stay on this computer.',
  },
  groups: {
    what: 'A group shares Spaces, instructions and a team memory with colleagues.',
    where: 'Shared Spaces appear in your list after you install them. The active group is used in chat.',
    effect: 'The group instructions and team memory are sent along with your messages while the group is active. Admins see who changed what.',
  },
  storage: {
    what: 'Where results are saved and how your settings travel between computers.',
    where: 'Storage locations are offered to the assistant. Sync and export copy your settings, never passwords or keys.',
    effect: 'A storage location is only used when you ask to save something. Sync writes to Supabase; import replaces your current settings.',
  },
  chat: {
    what: 'What shapes the chat besides your message: personas, your own slash commands and the morning briefing.',
    where: 'The row above the message box, the slash menu in the message box and the briefing on a new conversation.',
    effect: 'A persona and your commands are added to the message when you use them. Everything stays on this computer.',
  },
  data: {
    what: 'Everything personal the app keeps on this computer, and a trail of who approved what.',
    where: 'Memory, personas, commands, approvals, agents, groups and schedules. Conversations and look settings are not included.',
    effect: 'Export writes a file. Delete removes the data for good after you confirm. The audit trail only reads.',
  },
  general: {
    what: 'Light or dark appearance, text size in Spaces and voice input.',
    where: 'The whole app, immediately. Voice input appears as a microphone button in the message box.',
    effect: 'Voice sends your recording to the speech service you set up; only the recognised text is kept, no audio.',
  },
};

/** One "Effect" line per Settings section, matched by the start of the section title. */
export const SECTION_EFFECT: Array<[string, string]> = [
  ['Profiles', 'Click a profile to apply it. Your current look, start view, pins, skills and instructions are replaced; save them as a profile first if you want to keep them.'],
  ['Back to the original', 'Resets the listed settings on this computer. Saved profiles, memory and keys stay, so you can switch back to a profile afterwards.'],
  ['Save the current settings as a profile', 'Stores a named copy of your current settings. It stays on this computer and travels with Sync and Export.'],
  ['Original look', 'Only colours, sizes, font, density, contrast and motion are reset. Pins, starters and profiles stay.'],
  ['Accent colour', 'Changes the colour of buttons, selected tabs and highlights, in the app and in all Spaces.'],
  ['Text and layout', 'App text size zooms the whole window. Text size in Spaces scales only the Spaces. Density changes the spacing in lists and cards. Font changes the typeface of the app.'],
  ['Accessibility', 'High contrast and reduced motion apply at once and to every screen. They do not change any content.'],
  ['Start view', 'Decides what you see after the next start. It does not change the current session.'],
  ['Pinned Spaces', 'Pinned Spaces move to the top of the Spaces list in the order you pinned them.'],
  ['Favourite skills', 'Shows a button per skill under the message box. A click inserts the skill into the message.'],
  ['Suggestions on the empty chat', 'Hides or shows the built-in suggestion buttons on a new conversation.'],
  ['Cards under the chat', 'Hides or shows the briefing cards below the message box on a new conversation. The data behind them is not changed.'],
  ['Own starter prompts', 'Adds a button on the empty chat. A click puts the prompt into the message box so you can edit it before sending.'],
  ['Default setup', 'When several connectors could answer, the assistant is told which ones you prefer. The model itself is still chosen in the model menu of the message box.'],
  ['Answers', 'Language, length and tone become standing instructions that are added to every message.'],
  ['Standing instructions', 'Added to every message, in every conversation. Keep them short and general; do not put keys or passwords here.'],
  ['Chat window', '“Ask before actions” makes the assistant wait for your approval before it changes anything. The other switches add small helpers to the chat; they cost nothing unless you use them.'],
  ['What the assistant receives', 'A preview of the instruction block that is sent with every message, based on the settings above.'],
  ['Personas', 'The chosen persona adds a short style instruction to every message of the conversation until you switch it off. It never overrides safety rules or tool permissions.'],
  ['Own commands', 'A command you type with a slash is replaced by its prompt before the message is sent. Nothing runs by itself.'],
  ['Morning briefing', 'Builds a briefing from your memory and open approvals when you run the command. It reads only what is already on this computer.'],
  ['How memory works', 'Explains the three kinds of notes. It changes nothing by itself.'],
  ['What the assistant sees', 'Shows the exact memory text that goes along with your messages, so you can check it before you send.'],
  ['Levels and approvals', 'A request to share an entry on a higher level waits for a decision. Until it is approved, the entry stays on its current level.'],
  ['What are groups?', 'Explains what a group shares. It changes nothing by itself.'],
  ['Where the group lives', 'Local mode keeps the group on this computer for demos. Server mode uses the group server and shares with other people.'],
  ['Your data', 'Export saves all personal data as a file. Delete removes it from this computer after you confirm and cannot be undone.'],
  ['Audit trail', 'A read-only list of requests and decisions for skills, memory and agents. It shows the process, not independent control.'],
  ['Memory', 'While “Use memory” is on, your notes are added to each message. Turn it off to pause memory without deleting the notes.'],
  ['About me', 'Used when the answer depends on who you are, for example your role or region.'],
  ['How I like results', 'Used for format and style, for example short answers or tables.'],
  ['Projects and context', 'Used when your question is about one of these projects or topics.'],
  ['Who you are', 'The address is only a label that the group uses to recognise you. It is sent with your group actions.'],
  ['Your groups', 'Switch the active group here. Its instructions and team memory are then sent along with your messages.'],
  ['Shared Spaces', 'Install copies the group version to this computer. Publish sends your version to everybody in the group.'],
  ['Team memory', 'Visible to every member and sent to the assistant while the group is active. Keep personal and confidential details out.'],
  ['Group instructions', 'Added to the messages of every member while the group is active, on top of their own instructions.'],
  ['Recent activity', 'A read-only log of who changed the group, for transparency.'],
  ['Delete group', 'Removes the group for everybody. Spaces that were already installed on a computer stay there.'],
  ['Storage locations', 'The assistant sees these names and uses a location only when you ask it to save a result.'],
  ['Sync with Supabase', 'Save writes your settings to the shared table; Load replaces the settings on this computer with the saved ones. Passwords and keys are never part of it.'],
  ['Export and import', 'Export writes a file with your settings. Import replaces your current settings with the file, so export first if you want a backup.'],
  ['Appearance', 'System follows the macOS setting and switches automatically. Light or Dark stays fixed. Spaces follow the same choice.'],
  ['Text size in Spaces', 'Scales every Space, including those the agent builds for you. It does not change the app text size.'],
  ['Sprache', 'Wirkt nur auf die Spracheingabe: das Mikrofon im Eingabefeld. Ohne Key ist die Funktion aus.'],
];

/** The effect line for a section title, or '' when none is written. */
export function sectionEffect(title: string): string {
  const hit = SECTION_EFFECT.find(([key]) => title === key || title.startsWith(`${key}:`));
  return hit ? hit[1] : '';
}
