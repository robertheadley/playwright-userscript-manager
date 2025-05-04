// ==UserScript==
// @name         Example Logger
// @match        *://example.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

console.log('🎯 Example userscript ran on', location.href);

GM_setValue('greeting', 'Hello, world!');
console.log(GM_getValue('greeting', 'Default greeting'));

GM_addStyle("body { background: #222; color: #fff; }");

GM_registerMenuCommand('Say Hi', () => alert('Hi from userscript!'));