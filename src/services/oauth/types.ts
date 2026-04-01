export type OAuthTokens = any;
export type OAuthProfileResponse = any;
export type SubscriptionType = string;
export type BillingType = string;
export type OAuthTokenExchangeResponse = any;
export type RateLimitTier = string;
export type UserRolesResponse = any;

export type ReferralCampaign = string;

export type ReferrerRewardInfo = {
  amount_minor_units: number;
  currency: string;
};

export type ReferralEligibilityResponse = {
  eligible: boolean;
  referral_code_details?: {
    referral_link?: string;
    campaign?: string;
  };
  referrer_reward?: ReferrerRewardInfo | null;
  remaining_passes?: number | null;
  [key: string]: unknown;
};

export type ReferralRedemptionsResponse = {
  redemptions?: unknown[];
  limit?: number;
  [key: string]: unknown;
};
