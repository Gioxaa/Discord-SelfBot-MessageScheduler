import { REST, Routes } from 'discord.js';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import { Command } from '../interfaces/command';

// Dynamically load commands
const commands: any[] = [];
const commandsPath = path.join(__dirname, '../commands');

// Check if directory exists
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        // Use require to load module dynamically
        const commandModule = require(filePath);
        
        // Handle both default export and named exports based on how we defined them
        // In our case, we exported const adminCommand, storeCommand etc.
        // We iterate through exports to find the Command object
        for (const key in commandModule) {
            const potentialCommand = commandModule[key];
            if (potentialCommand && 'data' in potentialCommand && 'execute' in potentialCommand) {
                commands.push(potentialCommand.data.toJSON());
                console.log(`[Deploy] Loaded command: ${potentialCommand.data.name}`);
            }
        }
    }
} else {
    console.error(`[Deploy] Commands directory not found at ${commandsPath}`);
}

const rest = new REST({ version: '10' }).setToken(config.botToken || '');

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        if (config.guildId) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID || '', config.guildId),
                { body: commands },
            );
            console.log(`Successfully reloaded commands for Guild: ${config.guildId}`);
        } else {
            console.warn('⚠️ GUILD_ID not found. Using Global Deployment.');
            if (process.env.CLIENT_ID) {
                await rest.put(
                    Routes.applicationCommands(process.env.CLIENT_ID),
                    { body: commands },
                );
                console.log('Successfully reloaded global commands.');
            }
        }

    } catch (error) {
        console.error(error);
    }
})();
