// src/lib/chatBotVariables.ts — the {variable} token catalog for Chat Bot
// message fields, mirrored from the website's own ChatBot.tsx VARIABLE_GROUPS
// (there's no API endpoint for this — the website's own component IS the
// catalog, so this is a direct port of that same list).
export const VARIABLE_GROUPS: { label: string; tokens: string[] }[] = [
  { label: 'You & Target', tokens: ['{sender}', '{userid}', '{target}', '{toname}', '{roles}'] },
  { label: 'Arguments', tokens: ['{v1}', '{v2}', '{v3}', '{variable}', '{optionalvariable}'] },
  { label: 'Channel', tokens: ['{channel}', '{subscribers}', '{followers}', '{viewers}', '{uptime}', '{title}', '{game}', '{kick_title}', '{kick_game}', '{twitch_title}', '{twitch_game}'] },
  { label: 'Chat & Points', tokens: ['{randomuser}', '{leaderboard}', '{commandlist}'] },
  { label: 'Viewer Relationship', tokens: ['{followage}', '{lastgame}'] },
  { label: 'Sub Record', tokens: ['{subrecord}', '{subrecordmonth}', '{substhismonth}'] },
  { label: 'Time & Random', tokens: ['{date}', '{time}', '{time America/New_York}', '{random}', '{randomlist A;B;C}', '{optionalrandomuser}', '{repeat 3 text}'] },
  { label: 'Math', tokens: ['{math 5 * 5}', '{round 4.6}', '{countdown 2027-01-01}', '{countup 2023-06-01}'] },
  { label: 'Fetch & URL', tokens: ['{fetch URL}', '{urlencode TEXT}', '{urldecode TEXT}', '{dadjoke}'] },
  { label: 'Platform', tokens: ['{platform}', '{platformurl}'] },
];
