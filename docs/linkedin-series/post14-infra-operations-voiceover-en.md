# Post 14 – Voiceover (EN)

Voice: Nova (American female, calm; blend of two voices). Music: original electronic piece in the style of early German electro-pop (drum machine, sequencer bass and arpeggio, vocoder-like pad, computer blips). Sample data; design study, not an SAP product. Laundry line: two white lab coats with a green badge and two bundles of colourful network cables; the cat sits with its back to the viewer at a large machine-room console with many monitors, paws on the desk. (Laundry and voice were not specified, chosen by me.) Screens: the Infrastructure Operations Space (simulated sample data), updated version with the seven-step process strip, the "Needs a decision" card and the status banner in the task view. Length about 6:23.


## IT infrastructure operations

Hi, I am Nova, Design Engineer! Design Study twenty twenty-six: IT infrastructure operations, from a request to a closed ticket.
These are possible design proposals within an MVP. Sample data, not a finished product. No system is changed.

## The operator's day

The overview starts with one rule: every change follows the same seven steps. Request, pre-check, approval, downtime window, upgrade, post-check, close. Under each step it says who acts: a person, the change manager, AWX, n8n, or automatic.
Then the numbers: four certificates expire within thirty days, one has expired, and two changes wait for a decision.
Below, the card needs a decision lists them. If you may approve, the button says so. Suggested work comes after, and nothing is changed by a suggestion.

## Inventory

The inventory holds certificates, VMs and DNS records, per customer, with the days that are left and a renew button.

## Only approved playbooks

Only approved playbooks run in production: renew a certificate, change a DNS record, patch a VM, and move a VM to another region. Rotate a secret is still a draft.
Each playbook states its parameters, and its rollback.

## A new task, checked first

A new task starts with a playbook, a target from the inventory, and a window.
Before it can be created, the request is checked against the inventory and the rules: validity, chain, key, names, and conflicts in the change calendar.

## Five columns

Every task moves through five columns: planned, in review, approved, in window, and done. Each column says which of the seven steps it covers.
Risk and approvals show on the card. A blocked task now says why, here: the backup is too old.

## Steps 1 to 3

Open a task, and the first thing you see is one sentence: what is happening, who is needed, and what comes next. The action button sits right there.
Now the process, step by step. One: the task is created by the requester. Two: the pre-check. The playbook runs in check mode, so nothing is changed, and the result is passed, passed with notes, or blocked.
Three: approval. Production needs two approvals, a change manager and one other person. A low-risk system needs one. The requester never approves their own task.

## Steps 4 and 5

Four: the downtime window. The task starts only inside the approved window, and a freeze, like an audit or the year end, blocks it.
Five: the upgrade, run by AWX in six steps. A snapshot and a health check. Monitoring silenced, and maintenance mode on. The change itself. The restart. A smoke test. And maintenance mode lifted again.

## Steps 6 and 7

Six: the post-check. Service, certificate, dependencies and monitoring are checked again. If a check fails, the step turns red and the process stops.
Seven: the ticket is closed, the Fleet Manager gets the success report, and the evidence is filed for the audit.
For a manager, the technical parts, the pre-check list, the diff and the log, stay folded away until you need them.

## n8n and AWX behind it

Behind it, two engines. n8n triggers, creates the task and the ticket, asks for approval in Teams, and waits for the window.
AWX runs the playbook: first the pre-check in check mode, then the real run, then the health checks.

## Where Joule comes in

And Joule? It plans a change, read only. After you confirm, it sends the request to n8n, always in check mode.
Approval and execution stay in n8n and AWX.

## Good to know

One honest note. Everything here is simulated sample data. No system is changed.
Joule plans and explains. Approvals and execution stay with people, n8n and AWX. A person decides.

## Close

From request to closed ticket. A person decides.
