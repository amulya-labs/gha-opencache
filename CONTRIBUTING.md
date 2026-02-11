# Contributing to OpenCache

Thank you for your interest in contributing to OpenCache! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- Node.js 20.x or 22.x
- npm 9.x or later
- Git

### Development Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/gha-opencache.git
   cd gha-opencache
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create a branch for your changes:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Workflow

### Building the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `lib/` directory.

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Code Quality

We use ESLint and Prettier to maintain code quality and consistency.

```bash
# Lint code
npm run lint

# Format code
npm run format

# Check formatting without making changes
npm run format:check
```

### Packaging

The action must be packaged before it can be used:

```bash
npm run package
```

This bundles the code and dependencies into `dist/` directories.

## Testing Guidelines

### Coverage Requirements

We maintain high test coverage standards:

- **Branches**: 80% minimum
- **Functions**: 80% minimum
- **Lines**: 80% minimum
- **Statements**: 80% minimum

Please ensure your changes include appropriate tests and maintain these coverage thresholds.

### Writing Tests

- Place tests in `__tests__/` directories alongside the code they test
- Use descriptive test names that explain what is being tested
- Follow the existing test patterns and structure
- Mock external dependencies appropriately
- Test both success and error cases

## Pull Request Process

### Before Submitting

1. Ensure all tests pass: `npm test`
2. Verify code formatting: `npm run format:check`
3. Check linting: `npm run lint`
4. Build successfully: `npm run build`
5. Package successfully: `npm run package`
6. Verify `dist/` changes are committed (required for GitHub Actions)

### Submitting a Pull Request

1. Push your changes to your fork
2. Create a pull request against the `main` branch
3. Fill out the pull request template
4. Ensure CI checks pass
5. Wait for review from maintainers

### Pull Request Guidelines

- **One feature per PR**: Keep changes focused and atomic
- **Clear description**: Explain what changes were made and why
- **Reference issues**: Link to related issues using `Fixes #123` or `Relates to #456`
- **Update documentation**: Update README.md or docs if needed
- **Add tests**: Include tests for new features or bug fixes
- **Commit dist/**: GitHub Actions require the packaged `dist/` directory

### Commit Messages

Follow conventional commit format:

```
type(scope): subject

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test changes
- `refactor`: Code refactoring
- `chore`: Build/tooling changes
- `perf`: Performance improvements

Examples:
```
feat(s3): add support for custom endpoint URLs

fix(restore): handle missing cache gracefully

docs: update storage backend configuration examples
```

## Adding Storage Backends

OpenCache has an extensible storage backend architecture. To add a new storage backend:

1. **Review the architecture**: See the existing backends in `src/storage/` for examples
2. **Implement the interface**: Create a new class implementing the `StorageBackend` interface
3. **Add configuration**: Update backend factory and configuration handling
4. **Write tests**: Add comprehensive unit tests for your backend
5. **Document usage**: Add examples and configuration docs to README.md
6. **Consider discussing first**: For major new backends, open a GitHub Discussion to align on approach

Key interfaces:
- `StorageBackend`: Core interface all backends must implement
- `BackendFactory`: Handles backend initialization
- Configuration validation and error handling

## Getting Help

- **Questions**: Start a [GitHub Discussion](https://github.com/amulya-labs/gha-opencache/discussions)
- **Bugs**: Open an [issue](https://github.com/amulya-labs/gha-opencache/issues/new/choose)
- **Security**: See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

## Development Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Testing Framework](https://jestjs.io/docs/getting-started)

## Recognition

Contributors are automatically added to the GitHub contributors list. Significant contributions may be acknowledged in release notes.

Thank you for contributing to OpenCache!
