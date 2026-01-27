/**
 * Smartly splits a message into chunks of <2000 characters.
 * Respects Code Blocks (```) and Custom Emojis (<:name:id>).
 */
export function smartSplit(text: string, maxLength: number = 2000): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let currentText = text;

    while (currentText.length > maxLength) {
        let splitIndex = maxLength;

        // 1. Safety Check: Don't cut inside a Custom Emoji (<:name:id>)
        // We look for a '<' before the limit and a '>' after the limit
        const lastOpenBracket = currentText.lastIndexOf('<', splitIndex);
        if (lastOpenBracket !== -1 && lastOpenBracket > splitIndex - 60) { // Emojis are usually < 60 chars
            const closingBracket = currentText.indexOf('>', lastOpenBracket);
            // If the closing bracket is AFTER our split index, we are cutting an emoji
            if (closingBracket > splitIndex) {
                splitIndex = lastOpenBracket; // Move back to before the emoji
            }
        }

        // 2. Safety Check: Don't cut inside a Code Block (```)
        // Count backticks in the chunk we are about to cut
        const chunk = currentText.substring(0, splitIndex);
        const backtickCount = (chunk.match(/```/g) || []).length;
        if (backtickCount % 2 !== 0) {
            // We are inside a code block.
            // Option A: Close it and reopen in next chunk (Complex)
            // Option B: Find the start of this block and cut before it (Simpler)
            const lastBackticks = chunk.lastIndexOf('```');
            if (lastBackticks !== -1) {
                splitIndex = lastBackticks;
            }
        }

        // 3. Preference: Cut at a newline or space
        const lastNewline = currentText.lastIndexOf('\n', splitIndex);
        if (lastNewline !== -1 && lastNewline > splitIndex * 0.7) { // Only if it's reasonably close to the end
            splitIndex = lastNewline;
        } else {
            const lastSpace = currentText.lastIndexOf(' ', splitIndex);
            if (lastSpace !== -1 && lastSpace > splitIndex * 0.7) {
                splitIndex = lastSpace;
            }
        }

        // Final Push
        chunks.push(currentText.substring(0, splitIndex));
        currentText = currentText.substring(splitIndex).trim(); // Trim leading newlines/spaces
    }

    if (currentText.length > 0) {
        chunks.push(currentText);
    }

    return chunks;
}
