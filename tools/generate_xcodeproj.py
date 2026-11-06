#!/usr/bin/env python3
"""
Generates UnityVault.xcodeproj (Xcode 16+, objectVersion 77) without third-party tools.

The project uses file-system synchronized groups, so every Swift file inside App/ and
UITests/ is picked up automatically – re-running this script is only necessary when
build settings or targets change.

Usage: python3 tools/generate_xcodeproj.py
"""
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.join(ROOT, "UnityVault.xcodeproj")
BUNDLE_ID = "com.xmznster.unityvault"
DEPLOYMENT_TARGET = "18.0"


def oid(name: str) -> str:
    return hashlib.md5(name.encode()).hexdigest()[:24].upper()


I = {k: oid(k) for k in [
    "project", "mainGroup", "productsGroup", "appProduct", "uitestProduct",
    "appTarget", "uitestTarget", "grpApp", "grpUITests", "excApp",
    "srcApp", "fwApp", "resApp", "srcUIT", "fwUIT", "resUIT",
    "bfVaultKit", "pkgRef", "prodVaultKit", "proxy", "dep",
    "clProject", "clApp", "clUIT", "cfgProjDebug", "cfgProjRelease",
    "cfgAppDebug", "cfgAppRelease", "cfgUITDebug", "cfgUITRelease",
]}


def settings(d: dict, indent: int = 4) -> str:
    pad = "\t" * indent
    lines = []
    for k in sorted(d):
        v = d[k]
        if isinstance(v, list):
            items = "".join(f"{pad}\t{q(x)},\n" for x in v)
            lines.append(f"{pad}{k} = (\n{items}{pad});")
        else:
            lines.append(f"{pad}{k} = {q(v)};")
    return "\n".join(lines)


def q(v) -> str:
    s = str(v)
    if re.fullmatch(r"[A-Za-z0-9_./]+", s):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


common_project = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS": "YES",
    "CLANG_ANALYZER_NONNULL": "YES",
    "CLANG_CXX_LANGUAGE_STANDARD": "gnu++20",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "CLANG_ENABLE_OBJC_WEAK": "YES",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "GCC_NO_COMMON_BLOCKS": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": DEPLOYMENT_TARGET,
    "LOCALIZATION_PREFERS_STRING_CATALOGS": "YES",
    "SDKROOT": "iphoneos",
    "SWIFT_VERSION": "5.0",
}
proj_debug = dict(common_project, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_TESTABILITY": "YES",
    "GCC_DYNAMIC_NO_PIC": "NO",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "GCC_PREPROCESSOR_DEFINITIONS": ["DEBUG=1", "$(inherited)"],
    "MTL_ENABLE_DEBUG_INFO": "INCLUDE_SOURCE",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG $(inherited)",
    "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
})
proj_release = dict(common_project, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
    "ENABLE_NS_ASSERTIONS": "NO",
    "MTL_ENABLE_DEBUG_INFO": "NO",
    "SWIFT_COMPILATION_MODE": "wholemodule",
    "VALIDATE_PRODUCT": "YES",
})
app = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "DEVELOPMENT_TEAM": "",
    "ENABLE_PREVIEWS": "YES",
    "GENERATE_INFOPLIST_FILE": "NO",
    "INFOPLIST_FILE": "App/Info.plist",
    "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"],
    "MARKETING_VERSION": "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID,
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
    "SUPPORTS_MACCATALYST": "NO",
    "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "NO",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "TARGETED_DEVICE_FAMILY": "1",
}
uit = {
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "DEVELOPMENT_TEAM": "",
    "GENERATE_INFOPLIST_FILE": "YES",
    "MARKETING_VERSION": "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID + ".uitests",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "SWIFT_EMIT_LOC_STRINGS": "NO",
    "TARGETED_DEVICE_FAMILY": "1",
    "TEST_TARGET_NAME": "UnityVault",
}


def cfg(id_, name, s):
    return f"""\t\t{id_} /* {name} */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
{settings(s)}
\t\t\t}};
\t\t\tname = {name};
\t\t}};
"""


def phase(id_, isa, files=""):
    return f"""\t\t{id_} = {{
\t\t\tisa = {isa};
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
{files}\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
"""


pbx = f"""// !$*UTF8*$!
{{
\tarchiveVersion = 1;
\tclasses = {{
\t}};
\tobjectVersion = 77;
\tobjects = {{

/* Begin PBXBuildFile section */
\t\t{I['bfVaultKit']} /* VaultKit in Frameworks */ = {{isa = PBXBuildFile; productRef = {I['prodVaultKit']} /* VaultKit */; }};
/* End PBXBuildFile section */

/* Begin PBXContainerItemProxy section */
\t\t{I['proxy']} /* PBXContainerItemProxy */ = {{
\t\t\tisa = PBXContainerItemProxy;
\t\t\tcontainerPortal = {I['project']} /* Project object */;
\t\t\tproxyType = 1;
\t\t\tremoteGlobalIDString = {I['appTarget']};
\t\t\tremoteInfo = UnityVault;
\t\t}};
/* End PBXContainerItemProxy section */

/* Begin PBXFileReference section */
\t\t{I['appProduct']} /* UnityVault.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = UnityVault.app; sourceTree = BUILT_PRODUCTS_DIR; }};
\t\t{I['uitestProduct']} /* UnityVaultUITests.xctest */ = {{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = UnityVaultUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }};
/* End PBXFileReference section */

/* Begin PBXFileSystemSynchronizedBuildFileExceptionSet section */
\t\t{I['excApp']} /* Exceptions for "App" folder in "UnityVault" target */ = {{
\t\t\tisa = PBXFileSystemSynchronizedBuildFileExceptionSet;
\t\t\tmembershipExceptions = (
\t\t\t\tInfo.plist,
\t\t\t);
\t\t\ttarget = {I['appTarget']} /* UnityVault */;
\t\t}};
/* End PBXFileSystemSynchronizedBuildFileExceptionSet section */

/* Begin PBXFileSystemSynchronizedRootGroup section */
\t\t{I['grpApp']} /* App */ = {{
\t\t\tisa = PBXFileSystemSynchronizedRootGroup;
\t\t\texceptions = (
\t\t\t\t{I['excApp']} /* Exceptions for "App" folder in "UnityVault" target */,
\t\t\t);
\t\t\tpath = App;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{I['grpUITests']} /* UITests */ = {{
\t\t\tisa = PBXFileSystemSynchronizedRootGroup;
\t\t\tpath = UITests;
\t\t\tsourceTree = "<group>";
\t\t}};
/* End PBXFileSystemSynchronizedRootGroup section */

/* Begin PBXFrameworksBuildPhase section */
{phase(I['fwApp'], 'PBXFrameworksBuildPhase', chr(9)*4 + I['bfVaultKit'] + ' /* VaultKit in Frameworks */,' + chr(10))}{phase(I['fwUIT'], 'PBXFrameworksBuildPhase')}/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
\t\t{I['mainGroup']} = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{I['grpApp']} /* App */,
\t\t\t\t{I['grpUITests']} /* UITests */,
\t\t\t\t{I['productsGroup']} /* Products */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{I['productsGroup']} /* Products */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{I['appProduct']} /* UnityVault.app */,
\t\t\t\t{I['uitestProduct']} /* UnityVaultUITests.xctest */,
\t\t\t);
\t\t\tname = Products;
\t\t\tsourceTree = "<group>";
\t\t}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
\t\t{I['appTarget']} /* UnityVault */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {I['clApp']} /* Build configuration list for PBXNativeTarget "UnityVault" */;
\t\t\tbuildPhases = (
\t\t\t\t{I['srcApp']} /* Sources */,
\t\t\t\t{I['fwApp']} /* Frameworks */,
\t\t\t\t{I['resApp']} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tfileSystemSynchronizedGroups = (
\t\t\t\t{I['grpApp']} /* App */,
\t\t\t);
\t\t\tname = UnityVault;
\t\t\tpackageProductDependencies = (
\t\t\t\t{I['prodVaultKit']} /* VaultKit */,
\t\t\t);
\t\t\tproductName = UnityVault;
\t\t\tproductReference = {I['appProduct']} /* UnityVault.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};
\t\t{I['uitestTarget']} /* UnityVaultUITests */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {I['clUIT']} /* Build configuration list for PBXNativeTarget "UnityVaultUITests" */;
\t\t\tbuildPhases = (
\t\t\t\t{I['srcUIT']} /* Sources */,
\t\t\t\t{I['fwUIT']} /* Frameworks */,
\t\t\t\t{I['resUIT']} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t\t{I['dep']} /* PBXTargetDependency */,
\t\t\t);
\t\t\tfileSystemSynchronizedGroups = (
\t\t\t\t{I['grpUITests']} /* UITests */,
\t\t\t);
\t\t\tname = UnityVaultUITests;
\t\t\tpackageProductDependencies = (
\t\t\t);
\t\t\tproductName = UnityVaultUITests;
\t\t\tproductReference = {I['uitestProduct']} /* UnityVaultUITests.xctest */;
\t\t\tproductType = "com.apple.product-type.bundle.ui-testing";
\t\t}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
\t\t{I['project']} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 1600;
\t\t\t\tLastUpgradeCheck = 1600;
\t\t\t\tTargetAttributes = {{
\t\t\t\t\t{I['appTarget']} = {{
\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;
\t\t\t\t\t}};
\t\t\t\t\t{I['uitestTarget']} = {{
\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;
\t\t\t\t\t\tTestTargetID = {I['appTarget']};
\t\t\t\t\t}};
\t\t\t\t}};
\t\t\t}};
\t\t\tbuildConfigurationList = {I['clProject']} /* Build configuration list for PBXProject "UnityVault" */;
\t\t\tdevelopmentRegion = de;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\tde,
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t);
\t\t\tmainGroup = {I['mainGroup']};
\t\t\tminimizedProjectReferenceProxies = 1;
\t\t\tpackageReferences = (
\t\t\t\t{I['pkgRef']} /* XCLocalSwiftPackageReference "Packages/VaultKit" */,
\t\t\t);
\t\t\tpreferredProjectObjectVersion = 77;
\t\t\tproductRefGroup = {I['productsGroup']} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{I['appTarget']} /* UnityVault */,
\t\t\t\t{I['uitestTarget']} /* UnityVaultUITests */,
\t\t\t);
\t\t}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
{phase(I['resApp'], 'PBXResourcesBuildPhase')}{phase(I['resUIT'], 'PBXResourcesBuildPhase')}/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
{phase(I['srcApp'], 'PBXSourcesBuildPhase')}{phase(I['srcUIT'], 'PBXSourcesBuildPhase')}/* End PBXSourcesBuildPhase section */

/* Begin PBXTargetDependency section */
\t\t{I['dep']} /* PBXTargetDependency */ = {{
\t\t\tisa = PBXTargetDependency;
\t\t\ttarget = {I['appTarget']} /* UnityVault */;
\t\t\ttargetProxy = {I['proxy']} /* PBXContainerItemProxy */;
\t\t}};
/* End PBXTargetDependency section */

/* Begin XCBuildConfiguration section */
{cfg(I['cfgProjDebug'], 'Debug', proj_debug)}{cfg(I['cfgProjRelease'], 'Release', proj_release)}{cfg(I['cfgAppDebug'], 'Debug', app)}{cfg(I['cfgAppRelease'], 'Release', app)}{cfg(I['cfgUITDebug'], 'Debug', uit)}{cfg(I['cfgUITRelease'], 'Release', uit)}/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
\t\t{I['clProject']} /* Build configuration list for PBXProject "UnityVault" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{I['cfgProjDebug']} /* Debug */,
\t\t\t\t{I['cfgProjRelease']} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
\t\t{I['clApp']} /* Build configuration list for PBXNativeTarget "UnityVault" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{I['cfgAppDebug']} /* Debug */,
\t\t\t\t{I['cfgAppRelease']} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
\t\t{I['clUIT']} /* Build configuration list for PBXNativeTarget "UnityVaultUITests" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{I['cfgUITDebug']} /* Debug */,
\t\t\t\t{I['cfgUITRelease']} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
/* End XCConfigurationList section */

/* Begin XCLocalSwiftPackageReference section */
\t\t{I['pkgRef']} /* XCLocalSwiftPackageReference "Packages/VaultKit" */ = {{
\t\t\tisa = XCLocalSwiftPackageReference;
\t\t\trelativePath = Packages/VaultKit;
\t\t}};
/* End XCLocalSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
\t\t{I['prodVaultKit']} /* VaultKit */ = {{
\t\t\tisa = XCSwiftPackageProductDependency;
\t\t\tpackage = {I['pkgRef']} /* XCLocalSwiftPackageReference "Packages/VaultKit" */;
\t\t\tproductName = VaultKit;
\t\t}};
/* End XCSwiftPackageProductDependency section */
\t}};
\trootObject = {I['project']} /* Project object */;
}}
"""

scheme = f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{I['appTarget']}" BuildableName = "UnityVault.app" BlueprintName = "UnityVault" ReferencedContainer = "container:UnityVault.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES" shouldAutocreateTestPlan = "YES">
      <Testables>
         <TestableReference skipped = "NO" parallelizable = "NO">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{I['uitestTarget']}" BuildableName = "UnityVaultUITests.xctest" BlueprintName = "UnityVaultUITests" ReferencedContainer = "container:UnityVault.xcodeproj">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{I['appTarget']}" BuildableName = "UnityVault.app" BlueprintName = "UnityVault" ReferencedContainer = "container:UnityVault.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{I['appTarget']}" BuildableName = "UnityVault.app" BlueprintName = "UnityVault" ReferencedContainer = "container:UnityVault.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
"""

workspace = """<?xml version="1.0" encoding="UTF-8"?>
<Workspace version = "1.0">
   <FileRef location = "self:">
   </FileRef>
</Workspace>
"""

os.makedirs(os.path.join(PROJECT, "xcshareddata", "xcschemes"), exist_ok=True)
os.makedirs(os.path.join(PROJECT, "project.xcworkspace"), exist_ok=True)
with open(os.path.join(PROJECT, "project.pbxproj"), "w") as f:
    f.write(pbx)
with open(os.path.join(PROJECT, "xcshareddata", "xcschemes", "UnityVault.xcscheme"), "w") as f:
    f.write(scheme)
with open(os.path.join(PROJECT, "project.xcworkspace", "contents.xcworkspacedata"), "w") as f:
    f.write(workspace)
print("Generated", PROJECT)
