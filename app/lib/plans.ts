export interface Plan {
  name: string;
  displayName: string;
  price: number;
  currency: string;
  usageLimit: number;
  features: string[];
  recommended?: boolean;
  billingInterval?: string;
}

export const PLANS: Record<string, Plan> = {
  free: {
    name: "free",
    displayName: "Free",
    price: 0,
    currency: "USD",
    usageLimit: 20,
    billingInterval: "EVERY_30_DAYS",
    features: [
      "20 price modifications per month",
      "4 modification types (%, fixed, +, -)",
      "Basic modification history",
      "Product search and filtering",
      "Community support via email"
    ]
  },
  
  standard: {
    name: "standard",
    displayName: "Standard",
    price: 9.99,
    currency: "USD",
    usageLimit: 500,
    billingInterval: "EVERY_30_DAYS",
    features: [
      "500 price modifications per month",
      "All modification types and bulk operations",
      "Complete modification history with filters",
      "Advanced product filters and search",
      "CSV export of price changes",
      "Priority email support (48h response)",
      "Detailed usage analytics"
    ],
    recommended: true
  },
  
  pro: {
    name: "pro",
    displayName: "Professional",
    price: 19.99,
    currency: "USD",
    usageLimit: 99999,
    billingInterval: "EVERY_30_DAYS",
    features: [
      "Unlimited price modifications",
      "Bulk operations on 1000+ products",
      "Advanced analytics and profit insights",
      "API access for custom integrations",
      "Priority support (24h response time)",
      "Custom pricing rules and automation",
      "White-label reports and data export",
      "Advanced competitor price tracking"
    ]
  }
};

export function getPlan(planName: string): Plan {
  return PLANS[planName] || PLANS.free;
}

export function canUseFeature(subscription: any, feature: string): boolean {
  const plan = getPlan(subscription?.planName || 'free');
  
  // Check usage limits first
  if (subscription && subscription.usageCount >= plan.usageLimit) {
    return false;
  }
  
  // Feature-specific checks
  switch (feature) {
    case 'advanced_filters':
      return plan.name !== 'free';
    case 'csv_export':
      return plan.name === 'standard' || plan.name === 'pro';
    case 'bulk_operations':
      return plan.name === 'pro';
    case 'api_access':
      return plan.name === 'pro';
    case 'unlimited_modifications':
      return plan.name === 'pro';
    case 'priority_support':
      return plan.name !== 'free';
    case 'analytics':
      return plan.name === 'pro';
    case 'automation':
      return plan.name === 'pro';
    default:
      return true;
  }
}

export function formatPriceDisplay(price: number, currency: string = "USD"): string {
  if (price === 0) return "Free";
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  });
  
  return `${formatter.format(price)}/month`;
}

export function getUpgradeRecommendation(subscription: any): {
  shouldUpgrade: boolean;
  reason: string;
  recommendedPlan: string;
} {
  const currentPlan = getPlan(subscription?.planName || 'free');
  const usagePercentage = subscription 
    ? (subscription.usageCount / subscription.usageLimit) * 100 
    : 0;

  if (currentPlan.name === 'free' && usagePercentage > 80) {
    return {
      shouldUpgrade: true,
      reason: "You're approaching your monthly limit. Upgrade to continue modifying prices without interruption.",
      recommendedPlan: 'standard'
    };
  }

  if (currentPlan.name === 'standard' && usagePercentage > 90) {
    return {
      shouldUpgrade: true,
      reason: "You're a power user! Upgrade to Pro for unlimited modifications and advanced features.",
      recommendedPlan: 'pro'
    };
  }

  return {
    shouldUpgrade: false,
    reason: "Your current plan meets your needs.",
    recommendedPlan: currentPlan.name
  };
}