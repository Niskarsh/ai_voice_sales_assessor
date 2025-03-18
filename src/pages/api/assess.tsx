// pages/api/assess.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Data = {
  response?: string;
  error?: string;
};

export default function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method === 'POST') {
    const { transcript } = req.body;

    // Simulate an AI response based on the transcript content
    let simulatedResponse = '';
    if (typeof transcript === 'string' && transcript.toLowerCase().includes('discount')) {
      simulatedResponse = "I see you mentioned discounts. Can you tell me how you justify a lower price without compromising value?";
    } else {
      simulatedResponse = "That sounds interesting. Could you elaborate on how your product meets customer needs?";
    }

    // (Optional) Log or store the transcript for further analysis

    res.status(200).json({ response: simulatedResponse });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
