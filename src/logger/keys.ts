export const LogKey = {
  // Email
  EMAIL_RESEND_SEND: 'email.resend.send',
  EMAIL_RESEND_ERROR: 'email.resend.error',
  EMAIL_SMTP_SEND: 'email.smtp.send',
  EMAIL_NOOP: 'email.noop',
  EMAIL_NO_TRANSPORT: 'email.no_transport',

  // Auth
  AUTH_VERIFICATION_SENT: 'auth.verification.sent',
  AUTH_VERIFICATION_ERROR: 'auth.verification.error',
  AUTH_REQUEST: 'auth.request',

  // Account lifecycle
  ACCOUNT_RECLAIMED: 'account.reclaimed',
  ACCOUNT_RECLAIM_ERROR: 'account.reclaim.error',

  // Companies / tenancy
  COMPANY_CREATED: 'company.created',
  INVITATION_SENT: 'invitation.sent',
  INVITATION_ACCEPTED: 'invitation.accepted',

  // Admin console (staff actions; `action` field says what changed)
  ADMIN_ACTION: 'admin.action',

  // Product stock (website orders)
  PRODUCT_STOCK_RESERVED: 'product.stock.reserved',
  PRODUCT_STOCK_RELEASED: 'product.stock.released',

  // Shop orders
  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_EXPIRED: 'order.expired',
  ORDER_CLAIMED: 'order.claimed',
  ORDER_CARDS_CREATED: 'order.cards.created',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  ORDER_WEBHOOK_ERROR: 'order.webhook.error',

  // Cards / pages
  CARD_CREATED: 'card.created',
  CARD_LINKED: 'card.linked',
  PAGE_PUBLISHED: 'page.published',

  // Public tap
  TAP_RECORDED: 'tap.recorded',
  TAP_RESOLVE_MISS: 'tap.resolve.miss',

  // Billing
  BILLING_CHECKOUT_CREATED: 'billing.checkout.created',
  BILLING_WEBHOOK_RECEIVED: 'billing.webhook.received',
  BILLING_WEBHOOK_ERROR: 'billing.webhook.error',
  BILLING_SUBSCRIPTION_UPDATED: 'billing.subscription.updated',

  // Translation (Claude)
  TRANSLATE_OK: 'translate.ok',
  TRANSLATE_ERROR: 'translate.error',
  TRANSLATE_LIMIT_REACHED: 'translate.limit_reached',
  TRANSLATE_NOT_CONFIGURED: 'translate.not_configured',

  // Uploads / file storage
  STORAGE_READY: 'storage.ready',
  STORAGE_NOT_CONFIGURED: 'storage.not_configured',
  UPLOAD_STORED: 'upload.stored',

  // App lifecycle
  APP_BOOTSTRAP: 'app.bootstrap',
  APP_ERROR: 'app.error',
  APP_UNHANDLED_REJECTION: 'app.unhandled_rejection',
  APP_UNCAUGHT_EXCEPTION: 'app.uncaught_exception',

  // Database / connectivity
  DB_CONNECT_RETRY: 'db.connect.retry',
  DB_CONNECT_OK: 'db.connect.ok',
  DB_CONNECT_FAILED: 'db.connect.failed',
  DB_HEALTH_DOWN: 'db.health.down',
  DB_UNAVAILABLE: 'db.unavailable',
} as const;

export type LogKeyValue = (typeof LogKey)[keyof typeof LogKey];
