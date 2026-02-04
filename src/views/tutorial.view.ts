import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const GET_TOKEN_SCRIPT = `window.webpackChunkdiscord_app.push([[Symbol()],{},o=>{for(let e of Object.values(o.c))try{if(!e.exports||e.exports===window)continue;e.exports?.getToken&&(token=e.exports.getToken());for(let o in e.exports)e.exports?.[o]?.getToken&&"IntlMessagesProxy"!==e.exports[o][Symbol.toStringTag]&&(token=e.exports[o].getToken())}catch{}}]),window.webpackChunkdiscord_app.pop(),token;`;

export function renderTutorialMenu() {
    const embed = new EmbedBuilder()
        .setTitle('<a:key:1306062112329568306> **HOW TO GET DISCORD TOKEN** <a:key:1306062112329568306>')
        .setDescription(`
**Please select your device:**

<a:arrow:1306059259615903826> **PC / Laptop**
Recommended method using Google Chrome or Edge browser.

<a:arrow:1306059259615903826> **Android / Mobile**
Requires **Kiwi Browser** or **Yandex Browser** (Browsers that support Developer Console).

<a:alert:1306298772124336178> **SECURITY WARNING**
Your Token is your account password. **NEVER** share it with anyone else. We encrypt it for safety, but you must keep it secret.
`)
        .setColor(0x5865F2)
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_tutorial_pc')
                .setLabel('💻 PC / Laptop')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('btn_tutorial_android')
                .setLabel('📱 Android')
                .setStyle(ButtonStyle.Success)
        );

    return { content: null, embeds: [embed], components: [row] };
}

export function renderTutorialPC() {
    const embed = new EmbedBuilder()
        .setTitle('<a:GREEN_CROWN:1306056562435035190> **PC: Get Token Guide** <a:GREEN_CROWN:1306056562435035190>')
        .setDescription(`
<a:arrow:1306059259615903826> Open **Discord** in your browser (Chrome/Edge).
<a:arrow:1306059259615903826> Press \`Ctrl + Shift + I\` to open Developer Tools.
<a:arrow:1306059259615903826> Click on the **"Console"** tab.
<a:arrow:1306059259615903826> **Paste** the code below and press **Enter**.
<a:arrow:1306059259615903826> Your token will appear (text inside quotes \`"..."\`).
`)
        .setColor(0x5865F2);

    return { 
        content: `\`\`\`js\n${GET_TOKEN_SCRIPT}\n\`\`\``, 
        embeds: [embed], 
        components: [],
        ephemeral: true 
    };
}

export function renderTutorialAndroid() {
    const embed = new EmbedBuilder()
        .setTitle('<a:GREEN_CROWN:1306056562435035190> **Android: Get Token Guide** <a:GREEN_CROWN:1306056562435035190>')
        .setDescription(`
**Note:** The official Chrome mobile app does NOT support Console. You need **Kiwi Browser** (PlayStore).

<a:arrow:1306059259615903826> Install & Open **Kiwi Browser**.
<a:arrow:1306059259615903826> Login to **Discord Web** (discord.com/login).
<a:arrow:1306059259615903826> Click the **3 dots** (Menu) -> Select **Developer Tools**.
<a:arrow:1306059259615903826> Go to the **Console** tab.
<a:arrow:1306059259615903826> **Paste** the code below and press enter.
`)
        .setColor(0x57F287);

    return { 
        content: `\`\`\`js\n${GET_TOKEN_SCRIPT}\n\`\`\``, 
        embeds: [embed], 
        components: [],
        ephemeral: true 
    };
}
