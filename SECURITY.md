# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

We take the security of OpenCache seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**For security issues, please do NOT create a public GitHub issue.**

Instead, please report security vulnerabilities through one of the following methods:

1. **GitHub Security Advisories (Preferred)**: Use GitHub's [private vulnerability reporting](https://github.com/amulya-labs/gha-opencache/security/advisories/new) feature
2. **Email**: Contact the repository maintainers directly via GitHub

### What to Include

When reporting a vulnerability, please include:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Suggested fix (if any)
- Your contact information for follow-up

### Response Timeline

- **Initial Response**: We aim to acknowledge receipt within 48 hours
- **Status Update**: We will provide a detailed response within 5 business days
- **Fix Timeline**: Critical vulnerabilities will be addressed with high priority

### Security Update Process

1. We will investigate and validate the reported vulnerability
2. We will develop and test a fix
3. We will coordinate disclosure timing with the reporter
4. We will release a security update and credit the reporter (unless anonymity is requested)

## Security Best Practices

When using OpenCache:

- Always use the latest stable version
- Review and understand the permissions required by the action
- Use secrets management for sensitive data
- Monitor Dependabot alerts for dependency vulnerabilities
- Follow the principle of least privilege when configuring storage backends

## Scope

This security policy applies to:

- The OpenCache GitHub Action code
- Dependencies managed in package.json
- Official storage backend implementations

## Out of Scope

The following are typically out of scope:

- Issues in third-party storage services (S3, GCS, Azure, etc.)
- Social engineering attacks
- Physical security issues

Thank you for helping keep OpenCache and its users secure!
