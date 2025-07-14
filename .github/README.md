# GitHub Actions Workflows

This directory contains automated workflows for the Safeway Coupon Clipper Chrome extension.

## Workflows Overview

### 🚀 `build-extension.yml`
**Purpose**: Builds the Chrome extension package for Web Store submission

**Triggers**:
- Push to main/master branch
- Pull requests to main/master branch  
- Published releases

**Features**:
- Validates manifest.json and required files
- Builds webstore-ready ZIP package using `scripts/build-webstore.sh`
- Creates downloadable artifacts
- Automatically attaches packages to GitHub releases
- Includes security scanning for pull requests

**Artifacts**:
- `chrome-extension-webstore-v{version}` - Production build for releases
- `chrome-extension-dev-build` - Development build for testing

---

### ✅ `validate-extension.yml`
**Purpose**: Validates extension structure and code quality

**Triggers**:
- Push/PR with changes to JS, HTML, CSS, or manifest files

**Checks**:
- Manifest.json syntax and required fields
- JavaScript linting with JSHint
- HTML validation with HTMLHint
- File structure verification
- Size and performance analysis
- Chrome extension best practices
- Web-ext lint validation

---

### 🏷️ `release.yml`
**Purpose**: Automated release creation from version tags

**Triggers**:
- Push of version tags (e.g., `v2.0.0`, `v2.1.3`)

**Features**:
- Verifies tag version matches manifest.json version
- Builds webstore package
- Generates changelog from git commits
- Creates GitHub release with package attachment
- Provides installation and submission instructions

**Usage**:
```bash
# Create and push a version tag
git tag v2.0.1
git push origin v2.0.1
```

---

### 🛡️ `security.yml`
**Purpose**: Security scanning and compliance checks

**Triggers**:
- Push to main/master
- Pull requests
- Weekly scheduled scan (Mondays 9 AM UTC)

**Security Checks**:
- Known vulnerability scanning with retire.js
- Manifest permission analysis
- JavaScript security pattern detection
- Privacy compliance verification
- Permission usage audit

**Reports**:
- Generates security report artifacts
- Flags overly broad permissions
- Identifies deprecated API usage

---

### 🔄 `dependabot.yml`
**Purpose**: Automated dependency updates

**Schedule**: Weekly on Mondays

**Updates**:
- GitHub Actions to latest versions
- npm dependencies (security updates only)

## Usage Guide

### For Development
1. **Code Changes**: Push to main/master triggers validation and build
2. **Pull Requests**: Full validation suite runs automatically
3. **Security**: Weekly scans ensure ongoing security compliance

### For Releases
1. **Update Version**: Update version in `manifest.json`
2. **Create Tag**: 
   ```bash
   git tag v2.1.0
   git push origin v2.1.0
   ```
3. **Automatic Release**: GitHub release created with webstore package
4. **Download Package**: Get ZIP from releases page for Chrome Web Store upload

### Artifacts and Downloads
- **Development Builds**: Available in Actions > build-extension workflow runs
- **Release Packages**: Attached to GitHub releases
- **Security Reports**: Available in Actions > security workflow runs

## Chrome Web Store Submission

The automated builds create packages ready for direct Chrome Web Store submission:

1. Go to [GitHub Releases](../../releases)
2. Download the latest `safeway-coupon-clipper-v{version}-webstore.zip`
3. Upload directly to Chrome Web Store Developer Dashboard
4. No additional processing required

## Troubleshooting

### Build Failures
- Check that all required files exist (manifest.json, background.js, etc.)
- Verify manifest.json syntax is valid
- Ensure version in manifest matches git tag for releases

### Security Warnings
- Review flagged permissions and remove unused ones
- Update deprecated API usage (e.g., chrome.tabs.executeScript → chrome.scripting.executeScript)
- Ensure privacy policy exists and is current

### Failed Validation
- Run `web-ext lint` locally to debug issues
- Check JavaScript syntax with JSHint
- Verify HTML structure with HTMLHint

## Local Development

To test builds locally:
```bash
# Build webstore package
./scripts/build-webstore.sh

# Validate extension
npx web-ext lint
```

## Security Best Practices

The workflows enforce these security practices:
- ✅ Manifest V3 compliance
- ✅ Minimal permission principle
- ✅ No dangerous JavaScript patterns
- ✅ Regular security scanning
- ✅ Dependency updates
- ✅ Privacy policy verification

---

*These workflows ensure every release is thoroughly tested, secure, and ready for Chrome Web Store submission.*