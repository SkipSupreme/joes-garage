/**
 * Moneris REST API client for payment processing.
 *
 * Uses Moneris Hosted Tokenization for PCI SAQ-A compliance.
 * Card data never touches our server — Moneris returns a token via iframe.
 * We use that token to pre-authorize the deposit amount.
 *
 * Sandbox: api.moneris.io (test environment)
 * Production: api.moneris.com
 */

const MONERIS_API_URL = process.env.MONERIS_API_URL || 'https://gatewayt.moneris.com/chkt/request/request.php';
const MONERIS_STORE_ID = process.env.MONERIS_STORE_ID || '';
const MONERIS_API_TOKEN = process.env.MONERIS_API_TOKEN || '';
const MONERIS_CHECKOUT_ID = process.env.MONERIS_CHECKOUT_ID || '';

const IS_SANDBOX = !process.env.MONERIS_API_URL || process.env.MONERIS_API_URL.includes('gatewayt');

if (IS_SANDBOX) {
  console.warn(
    '\x1b[33m[Moneris] Running in SANDBOX mode. Set MONERIS_API_URL, MONERIS_STORE_ID, and MONERIS_API_TOKEN for production.\x1b[0m'
  );
}

interface MonerisResult {
  success: boolean;
  transactionId?: string;
  referenceNum?: string;
  responseCode?: string;
  message?: string;
}

/**
 * Pre-authorize a card token for the deposit amount.
 * This holds the funds but does not capture them.
 */
export async function preAuthorize(
  token: string,
  amount: number,
  orderId: string,
): Promise<MonerisResult> {
  if (IS_SANDBOX) {
    // In sandbox mode, simulate a successful pre-auth
    console.log(`[Moneris Sandbox] Pre-auth: $${amount.toFixed(2)} for order ${orderId}`);
    return {
      success: true,
      transactionId: `sandbox-txn-${Date.now()}`,
      referenceNum: `sandbox-ref-${orderId.split('-')[0]}`,
      responseCode: '027',
      message: 'APPROVED',
    };
  }

  if (!MONERIS_STORE_ID || !MONERIS_API_TOKEN) {
    return { success: false, message: 'Moneris credentials not configured' };
  }

  // Production Moneris API call
  const body = {
    store_id: MONERIS_STORE_ID,
    api_token: MONERIS_API_TOKEN,
    checkout_id: MONERIS_CHECKOUT_ID,
    txn_total: amount.toFixed(2),
    order_id: orderId,
    ticket: token,
    environment: 'qa',
    action: 'preauth',
  };

  try {
    const res = await fetch(MONERIS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    const responseCode = data.response?.receipt?.response_code;
    const approved = responseCode && parseInt(responseCode) < 50;

    return {
      success: approved,
      transactionId: data.response?.receipt?.trans_id,
      referenceNum: data.response?.receipt?.reference_num,
      responseCode,
      message: approved ? 'APPROVED' : (data.response?.receipt?.message || 'DECLINED'),
    };
  } catch (err) {
    console.error('Moneris pre-auth error:', err);
    return {
      success: false,
      message: 'Payment gateway unavailable',
    };
  }
}

/**
 * Capture a previously pre-authorized transaction.
 */
export async function capture(transactionId: string, amount: number): Promise<MonerisResult> {
  if (IS_SANDBOX) {
    console.log(`[Moneris Sandbox] Capture: $${amount.toFixed(2)} txn ${transactionId}`);
    return { success: true, transactionId, message: 'CAPTURED' };
  }

  if (!MONERIS_STORE_ID || !MONERIS_API_TOKEN) {
    return { success: false, message: 'Moneris credentials not configured' };
  }

  // Production: POST to Moneris completion endpoint
  const body = {
    store_id: MONERIS_STORE_ID,
    api_token: MONERIS_API_TOKEN,
    type: 'completion',
    txn_number: transactionId,
    comp_amount: amount.toFixed(2),
  };

  try {
    const res = await fetch(MONERIS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const responseCode = data.response?.receipt?.response_code;
    return {
      success: responseCode && parseInt(responseCode) < 50,
      transactionId: data.response?.receipt?.trans_id,
      message: data.response?.receipt?.message || 'CAPTURE FAILED',
    };
  } catch (err) {
    console.error('Moneris capture error:', err);
    return { success: false, message: 'Payment gateway unavailable' };
  }
}

/**
 * Void a previously pre-authorized transaction.
 */
export async function voidTransaction(transactionId: string): Promise<MonerisResult> {
  if (IS_SANDBOX) {
    console.log(`[Moneris Sandbox] Void: txn ${transactionId}`);
    return { success: true, transactionId, message: 'VOIDED' };
  }

  if (!MONERIS_STORE_ID || !MONERIS_API_TOKEN) {
    return { success: false, message: 'Moneris credentials not configured' };
  }

  const body = {
    store_id: MONERIS_STORE_ID,
    api_token: MONERIS_API_TOKEN,
    type: 'purchasecorrection',
    txn_number: transactionId,
  };

  try {
    const res = await fetch(MONERIS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const responseCode = data.response?.receipt?.response_code;
    return {
      success: responseCode && parseInt(responseCode) < 50,
      transactionId: data.response?.receipt?.trans_id,
      message: data.response?.receipt?.message || 'VOID FAILED',
    };
  } catch (err) {
    console.error('Moneris void error:', err);
    return { success: false, message: 'Payment gateway unavailable' };
  }
}
