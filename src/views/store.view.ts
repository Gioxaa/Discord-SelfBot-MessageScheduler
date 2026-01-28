import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { PRODUCTS } from '../config';

export function renderTerms(targetProductId?: string) {
    // Embed 1: English
    const embedEnglish = new EmbedBuilder()
        .setTitle('<a:alert:1306298772124336178> TERMS & DISCLAIMER (ENGLISH) <a:alert:1306298772124336178>')
        .setDescription(`
1. **Strictly Against ToS**
Automating user accounts (Self-botting) is a direct violation of Discord Terms of Service.

2. **Your Risk, Your Responsibility**
We provide the tool, but **YOU** control how it's used. We are **NOT** responsible for account locks, bans, or phone verification requests.

3. **Usage Limits**
Sending messages too fast (spamming) drastically increases ban risk. We recommend using safe intervals (slowmode).

4. **Data Privacy**
Your tokens are encrypted. However, you are responsible for your own account security.

5. **No Refunds**
All sales are final. We cannot refund subscriptions if your account gets banned or if Discord patches this method.

6. **Support Scope**
We only provide technical support for the bot itself. We cannot help unban your account.

7. **Use Alt Accounts**
We strongly recommend using secondary/burner accounts. Never run this tool on your main personal account.
`)
        .setColor(0xED4245); // Red

    // Embed 2: Indonesia
    const embedIndo = new EmbedBuilder()
        .setTitle('<a:alert:1306298772124336178> SYARAT & RISIKO (INDONESIA) <a:alert:1306298772124336178>')
        .setDescription(`
1. **Melanggar ToS**
Mengotomatisasi akun user (Self-bot) adalah pelanggaran keras terhadap Ketentuan Layanan Discord.

2. **Risiko Anda Sendiri**
Kami menyediakan alat, tapi **ANDA** yang mengendalikannya. Kami **TIDAK** bertanggung jawab atas akun yang terkunci, terbanned, atau minta verifikasi nomor HP.

3. **Batas Penggunaan**
Mengirim pesan terlalu cepat (spam) meningkatkan risiko banned. Gunakan interval yang aman (jangan terlalu brutal).

4. **Privasi Data**
Token Anda dienkripsi. Namun, keamanan akun Anda tetap menjadi tanggung jawab Anda pribadi.

5. **Tidak Ada Refund**
Semua pembayaran bersifat final. Tidak ada pengembalian dana jika akun Anda terbanned atau jika Discord memblokir metode ini.

6. **Lingkup Bantuan**
Kami hanya membantu masalah teknis bot. Kami tidak bisa membantu mengurus akun yang kena banned.

7. **Gunakan Akun Cadangan**
Sangat disarankan menggunakan akun kedua/tumbal. Jangan pernah menjalankan alat ini di akun utama Anda.
`)
        .setColor(0xED4245) // Red
        .setFooter({ text: 'By clicking "I Understand", you fully accept these risks.' });

    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    // If purchasing, show "I Understand" button
    if (targetProductId) {
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`btn_confirm_buy_${targetProductId}`)
                    .setLabel('✅ I Understand & Continue')
                    .setStyle(ButtonStyle.Success)
            );
        components.push(row);
    }

    return { embeds: [embedEnglish, embedIndo], components, ephemeral: true };
}

export function renderStore() {
    const embed = new EmbedBuilder()
        .setTitle('<a:GREEN_CROWN:1306056562435035190>  **AUTO POST**  <a:GREEN_CROWN:1306056562435035190>')
        .setDescription(`
\u200b
**FEATURES**
<a:arrow:1306059259615903826> **Full Auto-Post System** (Message Scheduler)
<a:arrow:1306059259615903826> **Auto Fetch System** (Fetch Server & Channel)
<a:arrow:1306059259615903826> **Dynamic Cooldown Detection** (Auto Detect Cooldown)
<a:arrow:1306059259615903826> **Multi-Account Support** (Independent Workers)
<a:arrow:1306059259615903826> **24/7 Cloud Stability** (No PC needed)

**PRICING PLANS**
${Object.values(PRODUCTS).map(p => `<a:arrow:1306059259615903826> **${p.name}** : Rp ${p.price.toLocaleString('id-ID')} / ${p.durationDays} Days`).join('\n')}
`)
        .setColor('Purple') // Discord Green
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp()
        .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_buy_7_DAYS')
                .setLabel('Weekly Pass')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_buy_30_DAYS')
                .setLabel('Monthly Pass')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_view_terms')
                .setLabel('📜 Terms & Risks')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('btn_view_tutorial')
                .setLabel('📚 How to get Token')
                .setStyle(ButtonStyle.Secondary)
        );

    return { content: null, embeds: [embed], components: [row] };
}
