import axios from 'axios';

interface DiscordUser {
    id: string;
    username: string;
    discriminator: string;
    avatar: string;
}

export async function validateToken(token: string): Promise<DiscordUser | null> {
    try {
        const response = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: {
                Authorization: token // Selfbot tokens are used directly without "Bot " prefix
            }
        });

        if (response.status === 200) {
            return response.data as DiscordUser;
        }
        return null;
    } catch (error) {
        // If 401 Unauthorized, token is invalid
        return null;
    }
}
