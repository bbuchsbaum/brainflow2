# Svelte UI Review Checklist

## For Gemini - Architecture & Performance Focus

### Component Architecture Review
- [ ] Evaluate component composition and hierarchy
- [ ] Assess prop drilling vs context usage  
- [ ] Review component boundaries and responsibilities
- [ ] Analyze reusability and modularity
- [ ] Check for circular dependencies

### State Management Analysis
- [ ] Review Zustand + Svelte 5 integration pattern
- [ ] Evaluate store granularity and structure
- [ ] Assess subscription patterns for efficiency
- [ ] Check for unnecessary re-renders
- [ ] Analyze state update batching

### Performance Optimization
- [ ] Profile render performance with DevTools
- [ ] Identify component re-render triggers
- [ ] Review virtual scrolling implementation
- [ ] Analyze bundle size and code splitting
- [ ] Check for memory leaks in effects

### Best Practices Assessment
- [ ] Svelte 5 runes usage patterns
- [ ] Component lifecycle management
- [ ] Event handler optimization
- [ ] Accessibility compliance
- [ ] Error boundary implementation

### Specific Recommendations Needed:
1. Optimal pattern for GPU render result display
2. Better state management architecture
3. Component testing strategy
4. Performance monitoring approach
5. Code splitting boundaries

## For O3 - Technical Depth & Correctness Focus

### GPU Integration Analysis
- [ ] WebGPU resource lifecycle correctness
- [ ] Memory management and cleanup
- [ ] Render pipeline efficiency
- [ ] Error handling completeness
- [ ] Cross-platform compatibility

### Type Safety Audit
- [ ] Review generated types accuracy
- [ ] Find and eliminate `any` types
- [ ] Verify Tauri API type coverage
- [ ] Check component prop types
- [ ] Validate store type definitions

### Async Operations Review
- [ ] Race condition analysis
- [ ] Promise rejection handling
- [ ] Loading state management
- [ ] Concurrent request handling
- [ ] Cleanup on cancellation

### Security & Robustness
- [ ] File path validation
- [ ] Input sanitization
- [ ] Error message exposure
- [ ] Resource exhaustion prevention
- [ ] Cross-origin concerns

### Integration Points
- [ ] Tauri command efficiency
- [ ] Handle lifecycle management
- [ ] IPC message sizing
- [ ] Binary data transfer optimization
- [ ] Event system performance

### Specific Deep-Dives Needed:
1. PNG transfer pipeline optimization options
2. SharedArrayBuffer feasibility analysis
3. Memory leak detection in GPU resources
4. Race condition scenarios in layer loading
5. Error recovery strategies

## Both Reviewers - Collaborative Focus

### Critical Path Analysis
1. **Volume Load → GPU Upload → First Render**
   - Measure each step timing
   - Identify bottlenecks
   - Suggest optimizations

2. **User Interaction → State Update → GPU Update → Canvas Update**
   - Profile the full loop
   - Find unnecessary steps
   - Recommend improvements

3. **Multi-layer Composition Pipeline**
   - Memory usage analysis
   - Blend performance
   - Optimization opportunities

### Refactoring Priorities
Rate each item 1-5 (5 = highest priority):
- [ ] PNG transfer elimination
- [ ] State management pattern
- [ ] Component hierarchy
- [ ] Type generation automation
- [ ] Test coverage improvement
- [ ] Performance monitoring
- [ ] Error handling consistency
- [ ] Documentation updates

### Code Quality Metrics
Please provide scores (1-10) and justification:
- Architecture cleanliness
- Performance optimization
- Type safety
- Error handling
- Code maintainability
- Testing readiness
- Documentation quality
- Developer experience

## Deliverable Format

### 1. Executive Summary
- Overall assessment
- Top 3 strengths  
- Top 3 concerns
- Recommended action plan

### 2. Detailed Findings
For each issue:
- Description
- Impact (High/Medium/Low)
- Current code example
- Recommended solution
- Implementation effort estimate

### 3. Code Examples
Provide specific refactoring examples for:
- State management pattern
- Component optimization
- Type improvements
- Performance fixes

### 4. Metrics & Measurements
- Current performance baseline
- Expected improvements
- Measurement methodology
- Success criteria

### 5. Implementation Roadmap
- Phase 1: Critical fixes (1-2 weeks)
- Phase 2: Performance optimization (2-3 weeks)  
- Phase 3: Architecture improvements (3-4 weeks)
- Phase 4: Testing & documentation (1-2 weeks)