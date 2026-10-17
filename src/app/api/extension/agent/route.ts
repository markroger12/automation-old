import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, parseBody } from '@/lib/api';
import { agentRequestSchema } from '@/lib/chatgpt-extension';
import { assertExtensionKey, handleAgentRequest } from '@/lib/services/chatgpt-extension';

export const dynamic = 'force-dynamic';

/**
 * Endpoint for the ChatGPT Worker Chrome extension. It has no dashboard session or CSRF cookie,
 * so it authenticates with the connection key from Settings (middleware lets this path through).
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    await assertExtensionKey(req.headers.get('authorization'));
    const body = await parseBody(req, agentRequestSchema);
    return NextResponse.json(await handleAgentRequest(body), { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
