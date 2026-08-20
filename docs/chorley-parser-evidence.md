# Chorley Building Society comparison-page parser evidence

Source: https://www.chorleybs.co.uk/intermediary/compare-all

The browser-rendered comparison page emits each mortgage product as a consecutive record with this visible field sequence:

1. Product name, for example `Later Life - 2 Year Discount 60% LTV`.
2. `Initial Interest Rate` followed by a percentage such as `4.99%`.
3. `Maximum Loan To Value (LTV)` followed by a percentage such as `60%`.
4. `Overall Cost for Comparison` followed by a percentage such as `7.30%`.
5. `Product Code` followed by an identifier such as `IP469`.
6. A `View details` link before the next product record.

The generic line-by-line local parser incorrectly treats the field labels and percentage lines as independent products. The Chorley rule must group this ordered field sequence into one product record, map the initial-rate percentage to `rate`, map the LTV to `maxLtv`, map the overall-cost percentage to `aprc`, and capture `Product Code` as `code`. The product title supplies term, type, and purpose only when it explicitly contains those attributes.
