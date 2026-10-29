import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreatePaypalSubscriptionInput,
  RevisePaypalSubscriptionInput,
  CancelPaypalSubscriptionInput,
  PaypalApiErrorBody,
  PaypalApiException,
  PaypalSubscriptionDetails,
  PaypalSubscriptionResult,
  PaypalWebhookVerificationResult,
  VerifyPaypalWebhookInput,
} from './types';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

@Injectable()
export class PaypalClientService {
  private cachedToken?: CachedToken;

  constructor(private readonly config: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.accessToken;
    }

    const body = await this.request<{
      access_token: string;
      expires_in: number;
    }>(
      '/v1/oauth2/token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.getBasicAuthToken()}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
      false,
    );

    this.cachedToken = {
      accessToken: body.access_token,
      expiresAt: Date.now() + Math.max(body.expires_in - 60, 0) * 1000,
    };

    return body.access_token;
  }

  async createSubscription(
    input: CreatePaypalSubscriptionInput,
  ): Promise<PaypalSubscriptionResult> {
    const payload: Record<string, unknown> = {
      plan_id: input.providerPlanId,
      custom_id: input.customId,
      application_context: {
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    };

    if (input.startTime) {
      payload.start_time = input.startTime;
      (
        payload.application_context as Record<string, unknown>
      ).shipping_preference = 'NO_SHIPPING';
    }
    if (input.quantity) payload.quantity = String(input.quantity);

    if (input.subscriberEmail) {
      payload.subscriber = {
        email_address: input.subscriberEmail,
      };
    }

    const raw = await this.request<Record<string, unknown>>(
      '/v1/billing/subscriptions',
      {
        method: 'POST',
        headers: input.requestId
          ? { 'PayPal-Request-Id': input.requestId }
          : undefined,
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(payload),
      },
    );

    return {
      id: String(raw.id),
      status: typeof raw.status === 'string' ? raw.status : undefined,
      approvalUrl: this.findApprovalUrl(raw),
      raw,
    };
  }

  async getPlan(id: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/billing/plans/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }
  async getSubscriptionTransactions(
    id: string,
    start: string,
    end: string,
  ): Promise<Record<string, unknown>> {
    return this.request(
      `/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
      { method: 'GET' },
    );
  }
  async getSubscription(
    providerSubscriptionId: string,
  ): Promise<PaypalSubscriptionDetails> {
    const raw = await this.request<Record<string, unknown>>(
      `/v1/billing/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
      { method: 'GET' },
    );

    return {
      id: String(raw.id),
      status: typeof raw.status === 'string' ? raw.status : undefined,
      planId: typeof raw.plan_id === 'string' ? raw.plan_id : undefined,
      billingInfo: this.asRecord(raw.billing_info),
      subscriber: this.asRecord(raw.subscriber),
      approvalUrl: this.findApprovalUrl(raw),
      raw,
    };
  }

  async reviseSubscription(
    input: RevisePaypalSubscriptionInput,
  ): Promise<PaypalSubscriptionResult> {
    const raw = await this.request<Record<string, unknown>>(
      `/v1/billing/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}/revise`,
      {
        method: 'POST',
        headers: { 'PayPal-Request-Id': input.requestId },
        body: JSON.stringify({
          plan_id: input.providerPlanId,
          application_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        }),
      },
    );
    return {
      id: input.providerSubscriptionId,
      status: typeof raw.status === 'string' ? raw.status : undefined,
      approvalUrl: this.findApprovalUrl(raw),
      raw,
    };
  }

  async createOrder(input: {
    requestId: string;
    checkoutId: string;
    amount: string;
    currency: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<Record<string, unknown>> {
    return this.request('/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'PayPal-Request-Id': input.requestId,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: input.checkoutId,
            invoice_id: input.requestId,
            amount: { currency_code: input.currency, value: input.amount },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              user_action: 'PAY_NOW',
            },
          },
        },
      }),
    });
  }
  async getOrder(id: string): Promise<Record<string, unknown>> {
    return this.request(`/v2/checkout/orders/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }
  async captureOrder(
    id: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    return this.request(
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      {
        method: 'POST',
        headers: {
          'PayPal-Request-Id': requestId,
          Prefer: 'return=representation',
        },
        body: '{}',
      },
    );
  }

  async cancelSubscription(
    input: CancelPaypalSubscriptionInput,
  ): Promise<void> {
    await this.request<Record<string, unknown>>(
      `/v1/billing/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({
          reason: input.reason ?? 'Subscription cancellation requested',
        }),
      },
    );
  }

  async verifyWebhook(
    input: VerifyPaypalWebhookInput,
  ): Promise<PaypalWebhookVerificationResult> {
    const raw = await this.request<Record<string, unknown>>(
      '/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',
        body: JSON.stringify({
          auth_algo: input.authAlgo,
          cert_url: input.certUrl,
          transmission_id: input.transmissionId,
          transmission_sig: input.transmissionSig,
          transmission_time: input.transmissionTime,
          webhook_id: this.config.get<string>('paypal.webhookId'),
          webhook_event: input.webhookEvent,
        }),
      },
    );
    const verificationStatus =
      typeof raw.verification_status === 'string'
        ? raw.verification_status
        : undefined;

    return {
      verified: verificationStatus === 'SUCCESS',
      verificationStatus,
      raw,
    };
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit,
    withBearer = true,
  ): Promise<T> {
    const headers = new Headers(init.headers);

    if (withBearer) {
      headers.set('Authorization', `Bearer ${await this.getAccessToken()}`);
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    const body = await this.parseResponse(response);

    if (!response.ok) {
      const errorBody = body as PaypalApiErrorBody;
      throw new PaypalApiException(
        errorBody.message ?? 'PayPal API request failed',
        response.status,
        endpoint,
        errorBody.debug_id,
        errorBody,
      );
    }

    return body as T;
  }

  private async parseResponse(
    response: Response,
  ): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { raw: text };
    }
  }

  private getBasicAuthToken(): string {
    const clientId = this.config.get<string>('paypal.clientId') ?? '';
    const clientSecret = this.config.get<string>('paypal.clientSecret') ?? '';
    return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }

  private get baseUrl(): string {
    return this.config.get<string>('paypal.baseUrl') ?? '';
  }

  private findApprovalUrl(raw: Record<string, unknown>): string | undefined {
    const links = raw.links;
    if (!Array.isArray(links)) return undefined;

    const approveLink: unknown = links.find(
      (link: unknown) =>
        this.asRecord(link)?.rel === 'approve' &&
        typeof this.asRecord(link)?.href === 'string',
    );

    return this.asRecord(approveLink)?.href as string | undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }
}
