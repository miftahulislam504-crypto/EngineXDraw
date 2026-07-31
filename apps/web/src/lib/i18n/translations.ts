import type { DesignTool, SelectionKind } from '@/lib/design-studio-store';
import type { MaterialThemeId, EnvironmentPreset } from '@/lib/render-theme';
import type {
  LibraryCategory,
  OccupancyType,
  Wall,
  ShaftType,
  SiteBoundaryEdge,
  ComplianceCategory,
  ComplianceCheckType,
  DesignStatistics,
} from '@archibim/object-model';

/**
 * i18n scope note: covers auth (login/register), the dashboard shell
 * (sidebar + project list), the new-project wizard, and — as of this
 * pass — the Design Studio (Toolbar, PropertiesPanel, RoomListPanel,
 * LibraryBrowser). The enum-keyed sections (tools, hints, selectionKinds,
 * wallTypes, occupancyTypes, libraryCategories) are typed as
 * Record<SomeUnion, string> against the actual union types in
 * design-studio-store.ts and @archibim/object-model, so a value added to
 * one of those unions will fail to compile here until both en.ts and
 * bn.ts supply a label for it.
 */
export interface Translations {
  common: {
    loading: string;
    cancel: string;
    save: string;
    delete: string;
    close: string;
    back: string;
    next: string;
    loadingFloorsProgress: string; // use {loaded} and {total} as placeholders
  };
  landing: {
    brandEyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    getStarted: string;
    signInLink: string;
    alreadyHaveAccount: string;
    sectionModulesEyebrow: string;
    sectionModulesTitle: string;
    moduleDesignTitle: string;
    moduleDesignBody: string;
    moduleSheetsTitle: string;
    moduleSheetsBody: string;
    moduleComplianceTitle: string;
    moduleComplianceBody: string;
    moduleEnvironmentalTitle: string;
    moduleEnvironmentalBody: string;
    moduleVisualizationTitle: string;
    moduleVisualizationBody: string;
    moduleAutomationTitle: string;
    moduleAutomationBody: string;
    moduleAnalyticsTitle: string;
    moduleAnalyticsBody: string;
    sectionWorkflowEyebrow: string;
    sectionWorkflowTitle: string;
    workflowStep1Title: string;
    workflowStep1Body: string;
    workflowStep2Title: string;
    workflowStep2Body: string;
    workflowStep3Title: string;
    workflowStep3Body: string;
    footerCta: string;
    footerTagline: string;
  };
  auth: {
    signIn: string;
    signingIn: string;
    createAccount: string;
    creatingAccount: string;
    fullName: string;
    email: string;
    password: string;
    noAccountYet: string;
    createOne: string;
    alreadyHaveAccount: string;
    errorWrongCredentials: string;
    errorEmailInUse: string;
    errorWeakPassword: string;
    errorGeneric: string;
  };
  sidebar: {
    projects: string;
    settings: string;
    signOut: string;
  };
  projectShell: {
    backToProjects: string;
    navOverview: string;
    navDesign: string;
    navSheets: string;
    navElevations: string;
    navCompliance: string;
    navEnvironmental: string;
    navVisualization: string;
    navAutomation: string;
    navAnalytics: string;
    openMenu: string;
    closeMenu: string;
  };
  dashboard: {
    eyebrow: string;
    title: string;
    newProject: string;
    loadingProjects: string;
    emptyStateMessage: string;
    justNow: string;
    minutesAgo: string; // use {n} as placeholder
    hoursAgo: string; // use {n} as placeholder
    daysAgo: string; // use {n} as placeholder
  };
  projectStatus: {
    active: string;
    onHold: string;
    completed: string;
  };
  wizard: {
    eyebrow: string;
    stepBasics: string;
    stepSite: string;
    stepBuildings: string;
    stepReview: string;
    projectName: string;
    descriptionOptional: string;
    siteAddress: string;
    landArea: string;
    zoningType: string;
    buildingName: string;
    floors: string;
    buildingType: string;
    addAnotherBuilding: string;
    remove: string;
    reviewName: string;
    reviewDescription: string;
    reviewAddress: string;
    reviewLandArea: string;
    reviewBuildings: string;
    creatingProject: string;
    createProject: string;
    createErrorMessage: string;
  };
  settings: {
    eyebrow: string;
    title: string;
    profileTitle: string;
    twoFactorTitle: string;
    twoFactorDescription: string;
    enable2FA: string;
    starting: string;
    scanQrInstruction: string;
    sixDigitCode: string;
    verify: string;
    twoFactorEnabledMessage: string;
    incorrectCodeMessage: string;
    startErrorMessage: string;
    languageTitle: string;
    languageDescription: string;
  };
  designStudio: {
    pageTitle: string;
    backToProject: string;
    usingLibraryItem: string; // use {name} as placeholder
    roomsButton: string;
    libraryButton: string;
    noBuildingsTitle: string;
    noBuildingsMessage: string;
    goToProjectOverview: string;
    explodedView: string;
    explodedViewTooltip: string;
    deleteSelection: string; // use {kind} as placeholder — kind is a translated selectionKinds value
    closeAriaLabel: string;
    view2D: string;
    view3D: string;
    addFloor: string;
    resetView: string;
    resetViewTooltip: string;
    zoomInTooltip: string;
    zoomOutTooltip: string;
    structuralBlock: {
      columnWithoutFooting: string;
      floatingBeamEnd: string;
      unsupportedSlabCorner: string;
      unsupportedRoofCorner: string;
      footingHasColumn: string;
      columnHasDependents: string;
      wallHasDependents: string;
    };
    toolGroups: {
      structure: string;
      openings: string;
      envelope: string;
      substructure: string;
      circulation: string;
      siteFurnishing: string;
      annotation: string;
    };
  };
  tools: Record<DesignTool, string>;
  hints: Record<DesignTool, string>;
  selectionKinds: Record<SelectionKind, string>;
  wallTypes: Record<Wall['type'], string>;
  occupancyTypes: Record<OccupancyType, string>;
  libraryCategories: Record<Exclude<LibraryCategory, 'CUSTOM'>, string>;
  shaftTypes: Record<ShaftType, string>;
  properties: {
    thickness: string;
    height: string;
    elevation: string;
    type: string;
    propertiesHeader: string;
    material: string;
    materialPlaceholder: string;
    libraryButton: string;
    fireRating: string;
    acousticRating: string;
    structuralNote: string;
    structuralNotePlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
    customParameters: string;
    customParamKeyPlaceholder: string;
    customParamValuePlaceholder: string;
    width: string;
    sillHeight: string;
    depth: string;
    elevationAboveFloor: string;
    topElevation: string;
    postSpacing: string;
    numberOfSteps: string;
    riserHeight: string;
    mullionSpacing: string;
    label: string;
    rotation: string;
    offset: string;
    dimensionLabelPlaceholder: string;
    doorWindowTag: string;
    noteText: string;
    gridPosition: string;
    viewDirection: string;
    viewDirectionLeft: string;
    viewDirectionRight: string;
    viewSectionButton: string;
    shaftType: string;
    startLevel: string;
    endLevel: string;
    boundaryInfo: string; // use {n} as placeholder — number of boundary points
    reshapeNote: string;
    deleteButton: string;
    siteBoundaryFrontEdge: string;
    siteBoundaryHint: string;
  };
  siteBoundaryEdges: Record<SiteBoundaryEdge, string>;
  roomsPanel: {
    title: string; // use {n} as placeholder
    totalArea: string; // use {area} as placeholder
    emptyState: string;
    name: string;
    number: string;
    occupancy: string;
    areaPerimeterVolume: string;
    floorFinish: string;
    floorFinishPlaceholder: string;
    wallFinish: string;
    wallFinishPlaceholder: string;
    ceilingFinish: string;
    ceilingFinishPlaceholder: string;
  };
  libraryPanel: {
    title: string;
    emptyState: string;
    addCustomItem: string;
    name: string;
    width: string;
    height: string;
    depth: string;
    customTag: string;
  };
  projectDetail: {
    eyebrow: string;
    notFound: string;
    archive: string;
    restore: string;
    openInDesignStudio: string;
    viewElevations: string;
    viewSheets: string;
    viewCompliance: string;
    viewEnvironmental: string;
    viewVisualization: string;
    viewAutomation: string;
    viewAnalytics: string;
    siteInformation: string;
    address: string;
    landArea: string;
    landAreaValue: string; // use {n} as placeholder
    zoning: string;
    noSiteInfo: string;
    buildings: string; // use {n} as placeholder
    floorLabel: string; // pluralized with an 's' suffix only when locale is 'en'
    noBuildings: string;
    team: string; // use {n} as placeholder
    addBuilding: string;
    addBuildingTitle: string;
    buildingNameLabel: string;
    numberOfFloorsLabel: string;
    buildingTypeLabel: string;
    totalAreaLabel: string;
    saveBuilding: string;
    cancel: string;
    addBuildingError: string;
  };
  elevations: {
    pageTitle: string;
    north: string;
    south: string;
    east: string;
    west: string;
    emptyState: string;
  };
  sections: {
    pageTitle: string; // use {label} as placeholder
    notFound: string;
  };
  sheetsPage: {
    pageTitle: string;
    newSheet: string;
    name: string;
    namePlaceholder: string;
    sheetNumber: string;
    sheetNumberPlaceholder: string;
    size: string;
    viewportType: string;
    viewportFloorPlan: string;
    viewportElevation: string;
    viewportSection: string;
    floor: string;
    direction: string;
    sectionLine: string;
    noSectionLinesYet: string;
    scaleLabel: string;
    scaleLabelPlaceholder: string;
    drawnBy: string;
    date: string;
    create: string;
    emptyState: string;
    open: string;
    exportPdf: string;
    notFound: string;
  };
  compliance: {
    pageTitle: string;
    buildingLabel: string;
    noBuildings: string;
    loadingData: string;
    siteInfoTitle: string;
    roadWidthLabel: string;
    roadWidthHint: string;
    save: string;
    saved: string;
    setbackInputsTitle: string;
    setbackSourceGeometric: string;
    setbackSourceManual: string;
    actualFrontLabel: string;
    actualRearLabel: string;
    actualSideLabel: string;
    metersUnit: string;
    severityError: string;
    severityWarning: string;
    severityInfo: string;
    gapsTitle: string;
    gapsBody: string;
    categories: Record<ComplianceCategory, string>;
    messages: Record<ComplianceCheckType, string>;
  };
  environmental: {
    pageTitle: string;
    buildingLabel: string;
    noBuildings: string;
    loadingData: string;
    controlsTitle: string;
    dateLabel: string;
    timeLabel: string;
    utcOffsetLabel: string;
    utcOffsetHint: string;
    presetNow: string;
    presetSummerSolstice: string;
    presetWinterSolstice: string;
    presetEquinox: string;
    sunAltitudeLabel: string;
    sunAzimuthLabel: string;
    sunBelowHorizon: string;
    usingDefaultLocation: string;
    gapsTitle: string;
    gapsBody: string;
  };
  visualization: {
    pageTitle: string;
    buildingLabel: string;
    noBuildings: string;
    loadingData: string;
    controlsTitle: string;
    materialThemeLabel: string;
    materialThemes: Record<MaterialThemeId, string>;
    environmentLabel: string;
    environmentPresets: Record<EnvironmentPreset, string>;
    qualityLabel: string;
    qualityHigh: string;
    qualityDraft: string;
    autoRotateLabel: string;
    walkthroughVideoLabel: string;
    startRecording: string;
    stopRecording: string;
    downloadRecording: string;
    walkthroughHint: string;
    recordingUnsupported: string;
    gapsTitle: string;
    gapsBody: string;
  };
  networkStatus: {
    offline: string;
    syncing: string;
    synced: string;
  };
  automation: {
    pageTitle: string;
    buildingLabel: string;
    noBuildings: string;
    loadingData: string;

    cleanupTitle: string;
    cleanupDescription: string;
    cleanupNoIssues: string;
    cleanupIssuesFound: string; // use {n}
    cleanupFixAll: string;
    cleanupFixing: string;
    cleanupFixed: string; // use {n}
    cleanupMessages: Record<'ZERO_LENGTH_WALL' | 'ORPHAN_OPENING' | 'DEGENERATE_BOUNDARY', string>; // use values from ModelIssue.values

    structuralTitle: string;
    structuralDescription: string;
    structuralNoIssues: string;
    structuralIssuesFound: string; // use {n}
    structuralMessages: Record<
      'COLUMN_WITHOUT_FOOTING' | 'FLOATING_BEAM' | 'UNSUPPORTED_SLAB_CORNER' | 'UNSUPPORTED_ROOF_CORNER',
      string
    >;

    roomNumberingTitle: string;
    roomNumberingDescription: string;
    roomNumberingRun: string;
    roomNumberingRunning: string;
    roomNumberingDone: string; // use {n}
    roomNumberingNoRooms: string;

    dimensionTitle: string;
    dimensionDescription: string;
    dimensionRun: string;
    dimensionRunning: string;
    dimensionDone: string; // use {n}

    sheetsTitle: string;
    sheetsDescription: string;
    sheetsRun: string;
    sheetsRunning: string;
    sheetsDone: string; // use {n}
    sheetsUpToDate: string;

    schedulesTitle: string;
    schedulesDescription: string;
    doorSchedule: string;
    windowSchedule: string;
    roomSchedule: string;
    exportPdf: string;
    exportFullReport: string;
    scheduleColTag: string;
    scheduleColWidth: string;
    scheduleColHeight: string;
    scheduleColSillHeight: string;
    scheduleColNumber: string;
    scheduleColName: string;
    scheduleColOccupancy: string;
    scheduleColArea: string;
    scheduleColPerimeter: string;
    scheduleEmptyState: string;

    revisionTitle: string;
    revisionDescription: string;
    revisionLabelPlaceholder: string;
    revisionCreate: string;
    revisionCreating: string;
    revisionEmptyState: string;
    revisionLocked: string;
    revisionUnlocked: string;
    revisionLock: string;
    revisionUnlock: string;
    revisionSnapshotNote: string;

    syncTitle: string;
    syncDescription: string;

    gapsTitle: string;
    gapsBody: string;
  };
  analytics: {
    pageTitle: string;
    buildingLabel: string;
    noBuildings: string;
    loadingData: string;

    designStatsTitle: string;
    designStatLabels: Record<keyof DesignStatistics, string>;

    spaceUtilTitle: string;
    spaceUtilTotalRoomArea: string; // use {n}
    spaceUtilTotalFootprint: string; // use {n}
    spaceUtilEfficiency: string; // use {n}
    spaceUtilEfficiencyUnknown: string;
    spaceUtilByOccupancy: string;

    progressTitle: string;
    progressActivityLabel: string;
    progressTotalElements: string; // use {n}
    progressVersionCount: string; // use {n}
    progressLastVersion: string;
    progressNoVersionsYet: string;

    teamTitle: string;
    teamActionCount: string; // use {n}
    teamLastActive: string;
    teamNeverActive: string;
    teamEmptyState: string;

    gapsTitle: string;
    gapsBody: string;
  };
}
