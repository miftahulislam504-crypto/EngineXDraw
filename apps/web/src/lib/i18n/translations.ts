import type { DesignTool, SelectionKind } from '@/lib/design-studio-store';
import type { MaterialThemeId, EnvironmentPreset } from '@/lib/render-theme';
import type {
  LibraryCategory,
  OccupancyType,
  PaintSpec,
  Wall,
  ShaftType,
  SiteBoundaryEdge,
  ComplianceCategory,
  ComplianceCheckType,
  DesignStatistics,
  DoorSwingDirection,
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
    deleteMultiSelection: string; // use {count} and {kind} placeholders — bulk-delete button label/tooltip
    closeAriaLabel: string;
    northLabel: string; // label next to the north-angle input overlaid on the floor plan (Phase C)
    buildingSelectLabel: string; // aria-label for the icon-only building selector in the compact header
    floorSelectLabel: string; // aria-label for the icon-only floor selector in the compact header
    view2D: string;
    view3D: string;
    addFloor: string;
    copyFloor: string; // Toolbar button that opens the copy-floor panel
    copyFloorTooltip: string; // tooltip for the copy-floor button
    copyFloorPanelTitle: string; // heading inside the copy-floor panel
    copyFloorPanelDescription: string; // short explanation of what gets copied
    copyFloorNoOtherFloors: string; // shown when the building has no other floor to copy onto
    copyFloorTargetsLabel: string; // label above the list of target-floor checkboxes
    copyFloorConfirm: string; // use {count} placeholder — confirm button, e.g. "Copy to 2 floors"
    copyFloorCancel: string;
    copyFloorSuccess: string; // use {count} placeholder — notice shown after a successful copy
    // Push button সরিয়ে auto-sync করা হয়েছে (ব্যবহারকারীর নির্দেশে —
    // ডেটা পাঠানোর জন্য কোনো ম্যানুয়াল বাটন থাকবে না)। এই তিনটা key
    // এখন একটা ছোট, non-intrusive status indicator-এর জন্য (দেখুন
    // useArchitecturalAutoSync.ts ও design page-এর header)।
    hubSyncSyncing: string; // debounce timer চলছে বা push in-progress
    hubSyncSynced: string; // use {version} placeholder — সর্বশেষ সফল sync
    hubSyncFailed: string; // use {error} placeholder
    resetView: string;
    resetViewTooltip: string;
    undoTooltip: string; // aria-label/tooltip for the Toolbar's Undo button (Phase 6)
    redoTooltip: string; // aria-label/tooltip for the Toolbar's Redo button (Phase 6)
    escTooltip: string; // aria-label/tooltip for the Toolbar's Esc/Stop button — clears any in-progress draw and the current selection (Phase 6)
    showFloorBelow: string; // aria-label for the Toolbar's floor-below reference toggle (Phase 7)
    showFloorBelowTooltip: string; // tooltip explaining the floor-below reference toggle (Phase 7)
    footingGroundFloorOnly: string; // shown on the disabled footing tool when the active floor isn't the ground floor (Phase 13)
    orthoMode: string; // aria-label for the Toolbar's Wall-tool Ortho (0°/90° lock) toggle
    orthoModeTooltip: string; // tooltip explaining the Ortho toggle
    multiSelectMode: string; // aria-label for the Toolbar's multi-select mode toggle
    multiSelectTooltip: string; // tooltip explaining the multi-select mode toggle
    wallLengthPrompt: {
      label: string; // label on the length input shown right after the wall's first point is placed
      placeholderFeet: string; // placeholder text in the feet box, e.g. "ft"
      placeholderInches: string; // placeholder text in the inches box, e.g. "in"
      confirm: string; // button that locks in the typed length and starts aiming direction
      cancel: string; // button that cancels the in-progress wall and clears drawStart
      aimHint: string; // shown after length is locked, telling the person to now tap a direction
    };
    zoomInTooltip: string;
    zoomOutTooltip: string;
    structuralBlock: {
      columnWithoutFooting: string;
      floatingBeamEnd: string;
      unsupportedSlabCorner: string;
      unsupportedRoofCorner: string;
      unsupportedCornerDetail: string;
      footingHasColumn: string;
      columnHasDependents: string;
      wallHasDependents: string;
      roofNotOnTopFloor: string;
      unsupportedBalcony: string;
      floorCountExceedsHub: string; // use {drawn} and {hub} placeholders
    };
    polygonDraft: {
      vertexCount: string; // use {n} as placeholder
      finishRectangle: string;
      finishShape: string;
      cancel: string;
    };
    stairDraft: {
      pointCount: string; // use {n} as placeholder
      finish: string;
      cancel: string;
    };
    stairUDraft: {
      // Shown per click: 0 points placed -> prompt for point 1, 1 point
      // -> prompt for point 2 (width), 2 points -> prompt for point 3
      // (length). Indexed by stairDraft.length, same pattern as
      // polygonDraft/stairDraft's own point-count prompts.
      promptWidthStart: string;
      promptWidthEnd: string;
      promptLength: string;
      cancel: string;
    };
    noteDraft: {
      textLabel: string;
      textPlaceholder: string;
      sizeLabel: string;
      sizeSmall: string;
      sizeMedium: string;
      sizeLarge: string;
      place: string;
      cancel: string;
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
  doorSwingDirections: Record<DoorSwingDirection, string>;
  occupancyTypes: Record<OccupancyType, string>;
  paintSheens: Record<NonNullable<PaintSpec['sheen']>, string>;
  libraryCategories: Record<Exclude<LibraryCategory, 'CUSTOM'>, string>;
  shaftTypes: Record<ShaftType, string>;
  properties: {
    length: string;
    thickness: string;
    height: string;
    elevation: string;
    type: string;
    propertiesHeader: string;
    material: string;
    materialPlaceholder: string;
    gutterWidth: string;
    libraryButton: string;
    color: string;
    resetColor: string;
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
    stairSummary: string; // use {steps} and {rise} placeholders
    flightLabel: string; // use {n} placeholder
    treadDepth: string; // use {depth} placeholder
    stairShape: string;
    stairShapeUShape: string;
    stairShapeUShapeHint: string;
    mullionSpacing: string;
    label: string;
    rotation: string;
    offset: string;
    dimensionLabelPlaceholder: string;
    doorWindowTag: string;
    doorSwingDirection: string;
    noteText: string;
    noteFontSize: string;
    gridPosition: string;
    viewDirection: string;
    viewDirectionLeft: string;
    viewDirectionRight: string;
    viewSectionButton: string;
    sectionDetailTarget: string;
    sectionDetailTargetNone: string;
    sectionDetailTargetStairGroup: string;
    sectionDetailTargetWallGroup: string;
    sectionDetailTargetBalconyGroup: string;
    sectionDetailTargetRailingGroup: string;
    sectionDetailTargetParapetGroup: string;
    sectionDetailTargetOpeningGroup: string;
    sectionDetailTargetHint: string;
    shaftType: string;
    startLevel: string;
    endLevel: string;
    boundaryInfo: string; // use {n} as placeholder — number of boundary points
    reshapeNote: string;
    deleteButton: string;
    siteBoundaryFrontEdge: string;
    siteBoundaryHint: string;
    bulkEditHeader: string; // use {count} and {kind} placeholders — header shown when a multi-select batch is active
    bulkEditHint: string; // use {count} placeholder — explains that changes apply to every selected element
    bulkSelectAll: string; // use {kind} placeholder — button that grows the batch to every element of that kind on the floor
    bulkDeleteButton: string; // use {count} placeholder
    bulkApplyButton: string; // use {count} placeholder
    bulkFieldPlaceholder: string; // shown in a bulk-edit field when the batch's elements don't share the same current value
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
    paintWalls: string;
    paintCeiling: string;
    paintColorName: string;
    paintColorNamePlaceholder: string;
    paintCode: string;
    paintCodePlaceholder: string;
    paintSheen: string;
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
    syncingFromHub: string;
    syncedFromHub: string;
    resyncFromHub: string;
    resyncConfirmTitle: string;
    resyncConfirmBody: string;
    resyncConfirmAction: string;
    hubSyncFailed: string;
    addBuildingManually: string;
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
    viewportRoofPlan: string;
    viewportSitePlan: string;
    viewportCoverSheet: string;
    viewportInfoSheet: string;
    infoSheetKind: string;
    infoSheetKindProjectInfo: string;
    infoSheetKindClientInfo: string;
    infoSheetKindSiteInfo: string;
    infoSheetKindDesignCriteria: string;
    infoSheetKindCodesStandards: string;
    infoSheetKindSiteLocation: string;
    infoSheetKindSiteSurvey: string;
    infoSheetBodyLabel: string;
    infoSheetBodyPlaceholderDesignCriteria: string;
    infoSheetBodyPlaceholderCodesStandards: string;
    infoSheetBodyPlaceholderSiteLocation: string;
    infoSheetBodyPlaceholderSiteSurvey: string;
    floor: string;
    direction: string;
    sectionLine: string;
    sectionLineDetailStair: string;
    sectionLineDetailWall: string;
    noSectionLinesYet: string;
    scaleLabel: string;
    scaleLabelPlaceholder: string;
    suggestScale: string;
    suggestScaleNeedsWalls: string;
    drawnBy: string;
    date: string;
    create: string;
    emptyState: string;
    open: string;
    exportPdf: string;
    notFound: string;
    generateSetTitle: string;
    generateSetDescription: string;
    generateSetAction: string;
    generateSetInProgress: string;
    generateSetNoSectionsHint: string;
    generateSetResultCreated: string; // use {count} as placeholder
    generateSetResultNoneNew: string;

    // Cover Sheet (viewportType === 'coverSheet')
    coverSheetProjectLabel: string;
    coverSheetClientLabel: string;
    coverSheetLocationLabel: string;
    coverSheetBuildingLabel: string;
    coverSheetBuildingTypeLabel: string;
    coverSheetFloorCountLabel: string;
    coverSheetNotProvided: string;
    coverSheetDrawingIndexTitle: string;
    coverSheetIndexColSheetNumber: string;
    coverSheetIndexColSheetName: string;
    coverSheetIndexColViewportType: string;
    coverSheetIndexEmptyState: string;
    coverSheetRevisionTitle: string;
    coverSheetRevisionColRev: string;
    coverSheetRevisionColDate: string;
    coverSheetRevisionColDescription: string;
    coverSheetRevisionPlaceholder: string;

    // Info Sheets (Audit Gap Closure Phase 1 — viewportType === 'infoSheet')
    infoSheetProjectInfoTitle: string;
    infoSheetClientInfoTitle: string;
    infoSheetSiteInfoTitle: string;
    infoSheetDesignCriteriaTitle: string;
    infoSheetCodesStandardsTitle: string;
    infoSheetSiteLocationTitle: string;
    infoSheetSiteSurveyTitle: string;
    infoSheetRowProjectName: string;
    infoSheetRowProjectCode: string;
    infoSheetRowLocation: string;
    infoSheetRowDescription: string;
    infoSheetRowStatus: string;
    infoSheetRowClientName: string;
    infoSheetRowBuildingName: string;
    infoSheetRowBuildingType: string;
    infoSheetRowFloorCount: string;
    infoSheetRowTotalArea: string;
    infoSheetRowSiteAddress: string;
    infoSheetRowLandArea: string;
    infoSheetRowZoningType: string;
    infoSheetRowRoadWidth: string;
    infoSheetRowSetbackFront: string;
    infoSheetRowSetbackRear: string;
    infoSheetRowSetbackSide: string;
    infoSheetBodyEmptyState: string;
    sheetEmphasisLabel: string;
    sheetEmphasisHint: string;
    sheetEmphasisParking: string;
    sheetEmphasisLandscape: string;
    sheetEmphasisFurniture: string;
    sheetEmphasisKitchen: string;
    sheetEmphasisBathroom: string;
    sheetEmphasisRoofDrain: string;
    sheetEmphasisDownspout: string;
    sheetEmphasisParapet: string;
    sheetEmphasisGutter: string;

    // Batch/Combined PDF export (Phase 4)
    batchExportTitle: string;
    batchExportDescription: string;
    batchExportAction: string;
    batchExportInProgress: string;
    batchExportEmptyState: string;
    batchExportSelectAll: string;
    batchExportSelectNone: string;
    batchExportSelectSheetLabel: string; // use {name}
    batchExportDrawnByOverride: string;
    batchExportDateOverride: string;
    batchExportOverridePlaceholder: string;

    // Sidebar title block (MICON-style redesign) — default text + shared labels
    titleBlockStatusDefault: string;

    // Title Block Settings (per-Building defaults, editable)
    titleBlockSettingsTitle: string;
    titleBlockSettingsDescription: string;
    titleBlockSettingsToggle: string;
    titleBlockSettingsSave: string;
    titleBlockSettingsSaved: string;
    titleBlockFieldCompanyName: string;
    titleBlockFieldCompanyLogoUrl: string;
    titleBlockFieldCompanyLogoUrlPlaceholder: string;
    titleBlockFieldCompanyAddress: string;
    titleBlockFieldCompanyAddressPlaceholder: string;
    titleBlockFieldCompanyPhone: string;
    titleBlockFieldCompanyEmail: string;
    titleBlockFieldJobNo: string;
    titleBlockFieldClientName: string;
    titleBlockFieldLocation: string;
    titleBlockFieldBuildingNo: string;
    titleBlockFieldDetailByName: string;
    titleBlockFieldDetailByCredential: string;
    titleBlockFieldDesignByName: string;
    titleBlockFieldDesignByCredential: string;
    titleBlockFieldCheckedByName: string;
    titleBlockFieldCheckedByCredential: string;
    titleBlockFieldApprovedByName: string;
    titleBlockFieldApprovedByCredential: string;
    titleBlockFieldCopyrightNotice: string;
    titleBlockFieldCopyrightNoticePlaceholder: string;

    // Combined PDF export — per-export title block override
    batchExportOverrideTitleBlockToggle: string;
    batchExportOverrideTitleBlockDescription: string;
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

    reportTitle: string;
    reportDescription: string;
    reportExport: string;
    reportSiteInfoLandArea: string; // use {n}
    reportSiteInfoRoadWidth: string; // use {n}
    reportSiteInfoNotEntered: string;
    reportBuiltUpAreaTitle: string;
    reportBuiltUpAreaFloor: string;
    reportBuiltUpAreaFootprint: string;
    reportBuiltUpAreaTotal: string;
    reportLoadSummaryTitle: string;
    reportLoadSummaryConcrete: string;
    reportLoadSummaryWalls: string;
    reportLoadSummaryTotal: string;
    reportLoadSummaryPerSqm: string;
    reportLoadSummaryUnavailable: string;
    reportLoadSummaryDisclaimer: string;
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
    columnSchedule: string;
    beamSchedule: string;
    stairSchedule: string;
    railingSchedule: string;
    finishSchedule: string;
    paintSchedule: string;
    foundationSchedule: string;
    footingSchedule: string;
    gridLineSchedule: string;
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
    scheduleColShape: string;
    scheduleColDepth: string;
    scheduleColLength: string;
    scheduleColElevation: string;
    scheduleColFlights: string;
    scheduleColSteps: string;
    scheduleColTotalRise: string;
    scheduleColPostSpacing: string;
    scheduleColFinishFloor: string;
    scheduleColFinishWalls: string;
    scheduleColFinishCeiling: string;
    scheduleColSurface: string;
    scheduleColPaintColor: string;
    scheduleColPaintCode: string;
    scheduleColPaintSheen: string;
    scheduleColThickness: string;
    scheduleColGridLabel: string;
    scheduleColOrientation: string;
    scheduleColPosition: string;
    columnShapes: Record<'RECTANGULAR' | 'CIRCULAR', string>;
    gridOrientations: Record<'vertical' | 'horizontal', string>;
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
