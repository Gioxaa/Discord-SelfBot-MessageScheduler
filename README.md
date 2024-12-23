# 📖 Discord-SelfBot-MessageScheduler
This project is a Discord self-bot that automatically sends messages to a specified channel with a random delay between messages. The bot can log successful message deliveries and handle multiple accounts, with customizable configurations for each account.

## 📫 Features

- **Message Scheduling**: Sends scheduled messages to Discord channels with random delays.
- **Webhook Logging**: Sends message delivery logs to a specified webhook in an embed format.
- **Multi-Account Support**: Allows for multiple Discord accounts to send messages based on individual configurations.
- **Customizable Configurations**: Each account can have a different message, delay range, and target channel.
- **Time Formatting**: Logs next message time and delay in a readable format.
  
## ⏳ Setup

1. Clone the repository:
    ```bash
    git clone https://github.com/Gioxaa/Discord-SelfBot-MessageScheduler.git
    cd Discord-SelfBot-MessageScheduler
    ```

2. Install dependencies:
    ```bash
    npm install discord.js-selfbot-v13 axios
    ```

3. Create a `configserver.json` file with the following structure:
    ```json
    {
        "webhook": "YOUR_WEBHOOK_URL",
        "accounts": [
            {
                "token": "YOUR_DISCORD_TOKEN",
                "guild": "YOUR_GUILD_ID",
                "channel": "YOUR_CHANNEL_ID",
                "message": ["Hello!", "How are you doing?"],
                "mindelay": 5000,
                "maxdelay": 10000
            }
        ]
    }
    ```

    - **webhook**: URL of the webhook to log message delivery.
    - **accounts**: An array of account configurations.
        - **token**: Discord token of the account.
        - **guild**: The ID of the server.
        - **channel**: The ID of the target channel.
        - **message**: The message(s) to be sent. Can be a single string or an array of strings.
        - **mindelay**: The minimum delay between messages (in milliseconds).
        - **maxdelay**: The maximum delay between messages (in milliseconds).

4. Run the bot:
    ```bash
    node main.js
    ```

## 💬 Commands

- The bot sends messages to a specified channel with random delays, and logs the activity to a webhook.
- The logs include:
  - Server name and channel name.
  - Time until the next message is sent.
  - Message content sent.

![png](https://cdn.discordapp.com/attachments/1292881258862477395/1320719131917680681/image.png?ex=676a9f0a&is=67694d8a&hm=8e339274b2d9a9bd07496da52f1275e755addde1ae1d675fe52fb3e0d6df2826&)


## 💡 Tips

- Be cautious with the frequency of messages, as excessive activity could result in a Discord account being temporarily or permanently banned.
- Ensure that your Discord account token is kept private and secure.
- Modify the message and delay settings in `config.json` to match your desired schedule.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
