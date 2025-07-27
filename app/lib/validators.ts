// app/lib/validators.ts - Updated validators for product-based quota

export interface PricingValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ProductQuotaValidationResult extends PricingValidationResult {
  quotaInfo?: {
    currentProducts: number;
    newProducts: number;
    totalAfter: number;
    limit: number;
    wouldExceed: boolean;
  };
}

export function validatePricingData(
  selectedProducts: any[],
  adjustmentType: string,
  adjustmentValue: number
): PricingValidationResult {
  const errors: string[] = [];
  
  // Validate product selection
  if (!selectedProducts || selectedProducts.length === 0) {
    errors.push("Please select at least one product to modify");
  }
  
  // Updated limit check - now based on reasonable bulk operation limits
  if (selectedProducts.length > 1000) {
    errors.push("Maximum 1000 products can be modified at once");
  }
  
  // Validate adjustment type
  if (!["percentage", "fixed", "add", "subtract"].includes(adjustmentType)) {
    errors.push("Invalid adjustment type selected");
  }
  
  // Validate adjustment value
  if (isNaN(adjustmentValue)) {
    errors.push("Adjustment value must be a valid number");
  }
  
  if (adjustmentType === "percentage") {
    if (adjustmentValue < -99 || adjustmentValue > 1000) {
      errors.push("Percentage must be between -99% and +1000%");
    }
  }
  
  if (adjustmentType === "fixed") {
    if (adjustmentValue < 0.01 || adjustmentValue > 99999) {
      errors.push("Fixed price must be between $0.01 and $99,999");
    }
  }
  
  if (adjustmentType === "add") {
    if (adjustmentValue < 0.01 || adjustmentValue > 9999) {
      errors.push("Add amount must be between $0.01 and $9,999");
    }
  }
  
  if (adjustmentType === "subtract") {
    if (adjustmentValue < 0.01 || adjustmentValue > 9999) {
      errors.push("Subtract amount must be between $0.01 and $9,999");
    }
    
    // Check if subtraction would result in negative prices
    const hasNegativeResult = selectedProducts.some(product => 
      product.variants.some((variant: any) => 
        variant.currentPrice - adjustmentValue < 0.01
      )
    );
    
    if (hasNegativeResult) {
      errors.push("Subtraction would result in negative or zero prices for some products");
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * NEW: Validate product quota limits - checks unique products instead of price changes
 */
export function validateProductQuota(
  selectedProducts: any[],
  currentProductsModified: string[],
  usageLimit: number
): ProductQuotaValidationResult {
  const errors: string[] = [];
  
  if (!selectedProducts || selectedProducts.length === 0) {
    errors.push("Please select at least one product to modify");
    return { isValid: false, errors };
  }
  
  // Extract product IDs from selection
  const selectedProductIds = selectedProducts.map(p => p.id);
  
  // Find which products are NEW (not already modified this period)
  const newProducts = selectedProductIds.filter(id => !currentProductsModified.includes(id));
  const totalAfter = currentProductsModified.length + newProducts.length;
  
  const quotaInfo = {
    currentProducts: currentProductsModified.length,
    newProducts: newProducts.length,
    totalAfter,
    limit: usageLimit,
    wouldExceed: totalAfter > usageLimit
  };
  
  if (quotaInfo.wouldExceed) {
    errors.push(
      `This selection would modify ${newProducts.length} new product(s), ` +
      `bringing your total to ${totalAfter} of ${usageLimit} allowed products this month. ` +
      `Please select fewer products or upgrade your plan.`
    );
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    quotaInfo
  };
}

export function validateProductData(product: any): boolean {
  if (!product.id || !product.title) return false;
  if (!product.variants || product.variants.length === 0) return false;
  
  return product.variants.every((variant: any) => 
    variant.id && 
    typeof variant.currentPrice === 'number' && 
    variant.currentPrice >= 0
  );
}

export function validateBulkOperation(
  selectedProducts: any[], 
  userPlan: string,
  currentProductsModified: string[] = []
): ProductQuotaValidationResult {
  const errors: string[] = [];
  
  // Plan-specific bulk operation limits (not quota limits)
  const bulkLimits = {
    free: 50,      // Can select up to 50 products in one operation
    standard: 250, // Can select up to 250 products in one operation  
    pro: 1000      // Can select up to 1000 products in one operation
  };
  
  const maxBulkProducts = bulkLimits[userPlan as keyof typeof bulkLimits] || 50;
  
  if (selectedProducts.length > maxBulkProducts) {
    errors.push(`Your ${userPlan} plan allows maximum ${maxBulkProducts} products per bulk operation`);
  }
  
  // Validate each product has required data
  const invalidProducts = selectedProducts.filter(product => !validateProductData(product));
  if (invalidProducts.length > 0) {
    errors.push(`${invalidProducts.length} product(s) have invalid or missing data`);
  }
  
  // Note: Quota validation should be done separately with validateProductQuota
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validatePriceRange(
  newPrice: number, 
  currentPrice: number,
  maxChangePercentage: number = 500
): PricingValidationResult {
  const errors: string[] = [];
  
  if (newPrice < 0.01) {
    errors.push("Price cannot be less than $0.01");
  }
  
  if (newPrice > 99999) {
    errors.push("Price cannot exceed $99,999");
  }
  
  // Check for extreme price changes
  if (currentPrice > 0) {
    const changePercentage = Math.abs((newPrice - currentPrice) / currentPrice) * 100;
    if (changePercentage > maxChangePercentage) {
      errors.push(`Price change of ${changePercentage.toFixed(1)}% exceeds recommended maximum of ${maxChangePercentage}%`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

export function sanitizeSearchQuery(query: string): string {
  return query
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 100); // Limit length
}

export function validateDateRange(startDate?: Date, endDate?: Date): PricingValidationResult {
  const errors: string[] = [];
  
  if (startDate && endDate) {
    if (startDate > endDate) {
      errors.push("Start date cannot be after end date");
    }
    
    const daysDifference = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDifference > 365) {
      errors.push("Date range cannot exceed 365 days");
    }
  }
  
  if (startDate && startDate > new Date()) {
    errors.push("Start date cannot be in the future");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Helper to get quota warning messages based on usage
 */
export function getQuotaWarningMessage(
  currentProducts: number,
  limit: number,
  planName: string
): { level: 'none' | 'warning' | 'critical', message: string } {
  const percentage = (currentProducts / limit) * 100;
  
  if (percentage >= 100) {
    return {
      level: 'critical',
      message: `You've reached your limit of ${limit} unique products this month. Upgrade to continue modifying prices.`
    };
  }
  
  if (percentage >= 80) {
    return {
      level: 'warning',
      message: `You've modified ${currentProducts} of ${limit} allowed products (${percentage.toFixed(1)}%). Consider upgrading soon.`
    };
  }
  
  return {
    level: 'none',
    message: `${currentProducts} of ${limit} products modified this month.`
  };
}

/**
 * Calculate the impact of a bulk selection on quota
 */
export function calculateQuotaImpact(
  selectedProductIds: string[],
  currentProductsModified: string[]
): {
  newProducts: string[];
  alreadyModified: string[];
  quotaImpact: number;
} {
  const newProducts = selectedProductIds.filter(id => !currentProductsModified.includes(id));
  const alreadyModified = selectedProductIds.filter(id => currentProductsModified.includes(id));
  
  return {
    newProducts,
    alreadyModified,
    quotaImpact: newProducts.length
  };
}