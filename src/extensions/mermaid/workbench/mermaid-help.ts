// The help sheet of Mermaid files. See mermaid in ../mermaid.ts.
import type { HelpSheet } from '../../../hosts/languages/languages';

/**
 * "Mermaid basics": flowcharts and sequence diagrams as merman draws them (Mermaid 12), each row ready to insert into
 * a `.mmd` file.
 */
export const MERMAID_HELP: HelpSheet = {
  title: 'Mermaid basics',
  sections: [
    {
      title: 'Flowchart',
      rows: [
        { snippet: 'flowchart LR', description: 'First line: a flowchart, left to right (TD: top down; RL, BT)' },
        { snippet: 'A[Text]', description: 'A node: its id, its text in a box' },
        { snippet: 'B(Rounded)', description: 'A node with rounded corners' },
        { snippet: 'C{Decision}', description: 'A rhombus' },
        { snippet: 'D((Circle))', description: 'A circle' },
        { snippet: 'E[(Database)]', description: 'A cylinder' },
        { snippet: 'A --> B', description: 'An arrow' },
        { snippet: 'A -- yes --> B', description: 'An arrow with a label' },
        { snippet: 'A -->|no| C', description: 'An arrow with a label, the other way to write it' },
        { snippet: 'A --- B', description: 'A line without an arrow head' },
        { snippet: 'A -.-> B', description: 'A dotted arrow' },
        { snippet: 'A ==> B', description: 'A thick arrow' },
        { snippet: 'subgraph Group\n  A --> B\nend', description: 'Nodes drawn together in a box with a title' },
        { snippet: '%% A comment', description: 'A comment line' },
      ],
    },
    {
      title: 'Sequence diagram',
      rows: [
        { snippet: 'sequenceDiagram', description: 'First line: a sequence diagram' },
        { snippet: 'participant A as Alice', description: 'A participant, named Alice, written A below' },
        { snippet: 'actor U as User', description: 'A participant drawn as a person' },
        { snippet: 'A->>B: Hello', description: 'A message with an arrow head' },
        { snippet: 'B-->>A: Hi', description: 'A reply (dotted)' },
        { snippet: 'A-)B: Later', description: 'An asynchronous message' },
        { snippet: 'Note right of A: A note', description: 'A note beside a participant (left of, right of)' },
        { snippet: 'Note over A,B: A note', description: 'A note across participants' },
        { snippet: 'loop Every minute\n  A->>B: Ping\nend', description: 'Messages repeated' },
        { snippet: 'alt Success\n  B->>A: OK\nelse Failure\n  B->>A: Error\nend', description: 'Alternative messages' },
      ],
    },
  ],
  links: [{ label: 'Mermaid documentation', href: 'https://mermaid.js.org/intro/' }],
};
