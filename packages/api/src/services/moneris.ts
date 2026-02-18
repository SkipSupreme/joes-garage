/**
 * Moneris Checkout (MCO) client for payment processing.
 *
 * Uses Moneris Checkout for PCI SAQ-A compliance.
 * Card data never touches our server — Moneris handles it via hosted iframe.
 *
 * Flow:
 *   1. preloadCheckout() → server gets a ticket from Moneris
 *   2. Frontend loads MCO JS + opens iframe with ticket → user enters card
 *   3. MCO processes payment, frontend gets callback
 *   4. getReceipt() → server confirms result with Moneris using the ticket
 *
 * Sandbox (gatewayt.moneris.com) is used when MONERIS_STORE_ID is not set.
 * Production (gateway.moneris.com) is used when all env vars are configured.
 */

import { logger } from '../lib/logger.js';

const MONERIS_STORE_ID = process.env.MONERIS_STORE_ID || '';
const MONERIS_API_TOKEN = process.env.MONERIS_API_TOKEN || '';
const MONERIS_CHECKOUT_ID = process.env.MONERIS_CHECKOUT_ID || '';

const IS_SANDBOX = !MONERIS_STORE_ID || !MONERIS_API_TOKEN || !MONERIS_CHECKOUT_ID;

const MCO_URL = IS_SANDBOX
  ? 'https://gatewayt.moneris.com/chkt/request/request.php'
  : 'https://gateway.moneris.com/chkt/request/request.php';

const MCO_ENV = IS_SANDBOX ? 'qa' : 'prod';

if (IS_SANDBOX && process.env.NODE_ENV === 'production') {
  throw new Error(
    '[Moneris] FATAL: Missing MONERIS_STORE_ID, MONERIS_API_TOKEN, or MONERIS_CHECKOUT_ID in production. ' +
    'Refusing to start with sandbox credentials. Set all three env vars to proceed.'
  );
} else if (IS_SANDBOX) {
  console.warn(
    '\x1b[33m[Moneris] Running in SANDBOX mode. Set MONERIS_STORE_ID, MONERIS_API_TOKEN, and MONERIS_CHECKOUT_ID for production.\x1b[0m'
  );
}

interface MonerisResult {
  success: boolean;
  transactionId?: string;
  referenceNum?: string;
  responseCode?: string;
  message?: string;
}

interface PreloadResult {
  success: boolean;
  ticket?: string;
  error?: string;
  isSandbox: boolean;
}

// ── Preload ──────────────────────────────────────────────────────────────────
/**
 * Create a Moneris Checkout instance by requesting a preload ticket.
 * The ticket is passed to the frontend MCO JS to display the payment iframe.
 */
export async function preloadCheckout(
  amount: number,
  orderId: string,
  customerEmail?: string,
): Promise<PreloadResult> {
  if (IS_SANDBOX) {
    logger.info({ amount: amount.toFixed(2), orderId }, 'Moneris sandbox preload');
    return {
      success: true,
      ticket: `sandbox-ticket-${Date.now()}`,
      isSandbox: true,
    };
  }

  const body: Record<string, any> = {
    store_id: MONERIS_STORE_ID,
    api_token: MONERIS_API_TOKEN,
    checkout_id: MONERIS_CHECKOUT_ID,
    txn_total: amount.toFixed(2),
    environment: MCO_ENV,
    action: 'preload',
    order_no: orderId.slice(0, 50),
    language: 'en',
  };

  if (customerEmail) {
    body.contact_details = { email: customerEmail };
  }

  try {
    const res = await fetch(MCO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.response?.success === 'true' && data.response?.ticket) {
      return {
        success: true,
        ticket: data.response.ticket,
        isSandbox: false,
      };
    }

    const errorMsg = data.response?.error
      ? JSON.stringify(data.response.error)
      : 'Preload failed';
    logger.error({ error: errorMsg }, 'Moneris preload error');
    return { success: false, error: errorMsg, isSandbox: false };
  } catch (err) {
    logger.error({ err }, 'Moneris preload network error');
    return { success: false, error: 'Payment gateway unavailable', isSandbox: false };
  }
}

// ── Receipt ──────────────────────────────────────────────────────────────────
/**
 * After MCO checkout completes, request the receipt to confirm the transaction.
 * In MCO, the transaction type (preauth/purchase) is configured in the
 * Merchant Resource Center — this just retrieves the result.
 */
export async function getReceipt(ticket: string): Promise<MonerisResult> {
  if (IS_SANDBOX) {
    logger.info({ ticket }, 'Moneris sandbox receipt');
    return {
      success: true,
      transactionId: `sandbox-txn-${Date.now()}`,
      referenceNum: `sandbox-ref-${ticket.slice(-8)}`,
      responseCode: '027',
      message: 'APPROVED',
    };
  }

  const body = {
    store_id: MONERIS_STORE_ID,
    api_token: MONERIS_API_TOKEN,
    checkout_id: MONERIS_CHECKOUT_ID,
    environment: MCO_ENV,
    action: 'receipt',
    ticket,
  };

  try {
    const res = await fetch(MCO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    const receipt = data.response?.receipt;

    if (!receipt) {
      return { success: false, message: 'No receipt in response' };
    }

    const responseCode = receipt.response_code;
    const approved = responseCode && parseInt(responseCode) < 50;

    return {
      success: approved,
      transactionId: receipt.trans_id,
      referenceNum: receipt.reference_num,
      responseCode,
      message: approved ? 'APPROVED' : (receipt.message || 'DECLINED'),
    };
  } catch (err) {
    logger.error({ err }, 'Moneris receipt error');
    return { success: false, message: 'Payment gateway unavailable' };
  }
}

// ── Capture ──────────────────────────────────────────────────────────────────
/**
 * Capture a previously pre-authorized transaction (post-checkout admin action).
 * Uses the Moneris Gateway API, not MCO.
 */
export async function capture(transactionId: string, amount: number): Promise<MonerisResult> {
  if (IS_SANDBOX) {
    logger.info({ amount: amount.toFixed(2), transactionId }, 'Moneris sandbox capture');
    return { success: true, transactionId, message: 'CAPTURED' };
  }

  if (!MONERIS_STORE_ID || !MONERIS_API_TOKEN) {
    return { success: false, message: 'Moneris credentials not configured' };
  }

  const body = {
    store_id: MONERIS_STORE_ID,
    api_token: MONERIS_API_TOKEN,
    type: 'completion',
    txn_number: transactionId,
    comp_amount: amount.toFixed(2),
  };

  try {
    const res = await fetch(MCO_URL, {
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
    logger.error({ err }, 'Moneris capture error');
    return { success: false, message: 'Payment gateway unavailable' };
  }
}

// ── Void ─────────────────────────────────────────────────────────────────────
/**
 * Void a previously pre-authorized transaction (release the hold).
 */
export async function voidTransaction(transactionId: string): Promise<MonerisResult> {
  if (IS_SANDBOX) {
    logger.info({ transactionId }, 'Moneris sandbox void');
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
    const res = await fetch(MCO_URL, {
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
    logger.error({ err }, 'Moneris void error');
    return { success: false, message: 'Payment gateway unavailable' };
  }
}
