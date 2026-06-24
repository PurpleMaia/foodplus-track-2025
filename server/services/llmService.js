'use server'
import { OpenAI } from 'openai';

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL
});

const SYSTEM_PROMPT = `
You are a legislative analyst specializing in food policy classification. Your task is to determine whether a bill relates to food policy, food systems, or related topics.

A bill is food-related if it addresses ANY of the following areas:

**Direct Food Topics:**
- Agriculture, farming, ranching, livestock, aquaculture
- Food production, processing, manufacturing, distribution
- Food safety, inspection, labeling, recalls
- Nutrition, dietary guidelines, food education
- Hunger, food insecurity, food access, food deserts
- Food assistance programs (SNAP, WIC, school meals, food banks)
- Grocery stores, restaurants, food service, food retail

**Agricultural Systems:**
- Crop production, seeds, fertilizers, pesticides, herbicides
- Soil health, irrigation, water for agriculture
- Farm labor, agricultural workers
- Agricultural land use, farmland preservation
- Farm subsidies, agricultural loans, crop insurance
- Organic farming, sustainable agriculture
- GMOs, biotechnology in food/agriculture

**Food-Adjacent Topics (INCLUDE these):**
- Fishing, hunting, foraging regulations
- Community gardens, urban agriculture
- Farmers markets, farm-to-table programs
- Food waste, composting of food materials
- Pollinator protection (bees, butterflies) for crops
- Food-related public health (obesity, diabetes from diet, foodborne illness)
- Land and water policies specifically impacting food production
- Import/export of food products
- Indigenous/Native food sovereignty
- Emergency food supply, disaster food relief

**Topics that are NOT food-related (EXCLUDE these):**
- General tax policy (unless specifically food taxes)
- Housing, transportation, education (unless about food programs)
- Healthcare (unless specifically nutrition/diet-related)
- Environmental policy (unless specifically about agriculture/food production)
- Economic development (unless specifically food/agriculture businesses)
- Water policy (unless specifically for agricultural irrigation)
- Labor policy (unless specifically farm/food workers)

**Decision Rules:**
1. If the PRIMARY purpose of the bill involves food, agriculture, or nutrition → YES
2. If food/agriculture is a SIGNIFICANT component (not incidental) → YES
3. If the bill ONLY mentions food as a minor example or passing reference → NO
4. If unclear, consider: "Would food policy advocates want to track this bill?" → If yes, classify as YES

You will receive a measure title and bill description. Analyze them and respond with exactly one word: yes or no

Do not explain your reasoning. Do not add punctuation or capitalization beyond the single lowercase word.
`;

export async function determineIfFoodRelated(measureTitle, description, maxRetries = 3, retryDelay = 1000) {  

    const context = `Title: ${measureTitle}\nDescription: ${description}`;
    console.log('[LLM] context:', measureTitle, `(model : ${process.env.VLLM || process.env.LLM})`);

    let attempt = 0;
    // console.log('CONTEXT:\n', context)
        while (attempt < maxRetries) {

            try {
                const model = process.env.VLLM || process.env.LLM || '';
                if (!model) {
                    console.log('model not found')
                    console.error('LLM model not configured. Please set VLLM or LLM environment variable.');
                    return null;
                }
                const response = await client.chat.completions.create({
                    model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: [
                                "Here is the bill's measure title and description:",
                                context,  
                                "",                                                       
                                "Does this bill relate to food policy, food systems, agriculture, nutrition, hunger, food security, or similar topics? Answer with one word: yes or no.",
                                " /no_think"
                            ].join("\n")
                        }
                    ],
                    temperature: 0.0
                });

                if (!response || !response.choices[0].message.content || !response.choices || !response.choices[0].message) {
                    console.log('[LLM] response not found')
                    return null;
                }
    
                const classification = response.choices[0].message.content.trim();
                console.log("[RESULT LLM] Bill Context:", measureTitle, `(${classification})`);                

                if (classification !== 'yes' && classification !== 'no') {
                    console.warn(`Unexpected classification "${classification}". Expected "yes" or "no".`);
                    return null;
                }
    
                const newStatus = classification === 'yes' ? true : false;
    
                return newStatus;
            } catch (error) {
                const err = error
                const status = err?.response?.status || err?.status;
                const message = typeof err?.message === 'string' ? err.message : String(err);
    
                // Retry on HTTP 524 (Cloudflare), ETIMEDOUT, or generic timeout message
                const isTimeout =
                    status === 524 ||
                    err?.code === 'ETIMEDOUT' ||
                    message.toLowerCase().includes('timeout');
    
                if (isTimeout) {
                    attempt++;
                    if (attempt < maxRetries) {
                        console.warn(`Timeout encountered. Retrying attempt ${attempt + 1} after ${retryDelay}ms...`);
                        await new Promise(res => setTimeout(res, retryDelay));
                        continue;
                    }
                }
                console.error(`Error:`, message);
                return null;
            }
        }
}