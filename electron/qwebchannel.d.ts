// electron/qwebchannel.d.ts — `qwebchannel` ships no types of its own (see
// meld-client.ts's own header). Declared untyped (`any`) rather than typed
// precisely, same as the bare `require()` this replaced used to return
// implicitly — meld-client.ts's own local cast narrows the one constructor
// it actually uses.
declare module 'qwebchannel';
