export interface PricingValidationResult {
  isValid: boolean;
  errors: string[];
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
  
  if (selectedProducts.length > 100) {
    errors.push("Maximum 100 products can be modified at once");
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
  userPlan: string
): PricingValidationResult {
  const errors: string[] = [];
  
  // Plan-specific limits
  const planLimits = {
    free: 10,
    standard: 100,
    pro: 1000
  };
  
  const maxProducts = planLimits[userPlan as keyof typeof planLimits] || 10;
  
  if (selectedProducts.length > maxProducts) {
    errors.push(`Your ${userPlan} plan allows maximum ${maxProducts} products per bulk operation`);
  }
  
  // Validate each product has required data
  const invalidProducts = selectedProducts.filter(product => !validateProductData(product));
  if (invalidProducts.length > 0) {
    errors.push(`${invalidProducts.length} product(s) have invalid or missing data`);
  }
  
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