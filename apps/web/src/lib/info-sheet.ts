import type { Building, InfoSheetKind, Project } from '@archibim/object-model';
import type { Translations } from './i18n';

export interface InfoSheetRow {
  label: string;
  value: string;
}

/**
 * Builds the {label, value} rows for the three data-backed Info Sheet
 * kinds (projectInfo/clientInfo/siteInfo) from Project/Building — the
 * ONE place both InfoSheetView (on-screen) and SheetCapture (export
 * data) read this shape from, so the printed sheet can never drift from
 * what's shown on screen. designCriteria/codesStandards aren't handled
 * here at all — those are free text (sheet.infoSheetBody), not rows;
 * see InfoSheetKind's own doc comment in object-model/sheets.ts.
 *
 * Every value falls back to '' (rendered as the not-provided em dash by
 * the caller) rather than throwing or omitting the row — a project
 * created before siteInfo existed, or one where a field was simply
 * never filled in, should still produce a complete, honestly-blank
 * sheet rather than a shorter row list that looks like the sheet itself
 * is missing content.
 */
export function buildInfoSheetRows(
  kind: Extract<InfoSheetKind, 'projectInfo' | 'clientInfo' | 'siteInfo'>,
  project: Project | null,
  building: Building | null,
  t: Translations,
): InfoSheetRow[] {
  switch (kind) {
    case 'projectInfo':
      return [
        { label: t.sheetsPage.infoSheetRowProjectName, value: project?.projectName ?? '' },
        { label: t.sheetsPage.infoSheetRowProjectCode, value: project?.projectCode ?? '' },
        { label: t.sheetsPage.infoSheetRowLocation, value: project?.location ?? '' },
        { label: t.sheetsPage.infoSheetRowDescription, value: project?.description ?? '' },
        { label: t.sheetsPage.infoSheetRowStatus, value: project?.status ?? '' },
      ];
    case 'clientInfo':
      return [
        { label: t.sheetsPage.infoSheetRowClientName, value: project?.clientName ?? '' },
        { label: t.sheetsPage.infoSheetRowLocation, value: project?.location ?? '' },
      ];
    case 'siteInfo':
      return [
        { label: t.sheetsPage.infoSheetRowSiteAddress, value: project?.siteInfo?.address ?? '' },
        {
          label: t.sheetsPage.infoSheetRowLandArea,
          value: project?.siteInfo?.landAreaSqm !== undefined ? String(project.siteInfo.landAreaSqm) : '',
        },
        { label: t.sheetsPage.infoSheetRowZoningType, value: project?.siteInfo?.zoningType ?? '' },
        {
          label: t.sheetsPage.infoSheetRowRoadWidth,
          value: project?.siteInfo?.roadWidthM !== undefined ? String(project.siteInfo.roadWidthM) : '',
        },
        {
          label: t.sheetsPage.infoSheetRowSetbackFront,
          value: project?.siteInfo?.actualSetbackFrontM !== undefined ? String(project.siteInfo.actualSetbackFrontM) : '',
        },
        {
          label: t.sheetsPage.infoSheetRowSetbackRear,
          value: project?.siteInfo?.actualSetbackRearM !== undefined ? String(project.siteInfo.actualSetbackRearM) : '',
        },
        {
          label: t.sheetsPage.infoSheetRowSetbackSide,
          value: project?.siteInfo?.actualSetbackSideM !== undefined ? String(project.siteInfo.actualSetbackSideM) : '',
        },
        { label: t.sheetsPage.infoSheetRowBuildingName, value: building?.name ?? '' },
        { label: t.sheetsPage.infoSheetRowBuildingType, value: building?.buildingType ?? '' },
        {
          label: t.sheetsPage.infoSheetRowFloorCount,
          value: building?.numberOfFloors !== undefined ? String(building.numberOfFloors) : '',
        },
        {
          label: t.sheetsPage.infoSheetRowTotalArea,
          value: building?.totalAreaSqm !== undefined ? String(building.totalAreaSqm) : '',
        },
      ];
  }
}

/** Sheet title (bold heading printed at the top of the page/PDF) for
 * each InfoSheetKind — shared between InfoSheetView and SheetCapture so
 * the on-screen heading and the printed one never disagree. */
export function infoSheetTitle(kind: InfoSheetKind, t: Translations): string {
  switch (kind) {
    case 'projectInfo':
      return t.sheetsPage.infoSheetProjectInfoTitle;
    case 'clientInfo':
      return t.sheetsPage.infoSheetClientInfoTitle;
    case 'siteInfo':
      return t.sheetsPage.infoSheetSiteInfoTitle;
    case 'designCriteria':
      return t.sheetsPage.infoSheetDesignCriteriaTitle;
    case 'codesStandards':
      return t.sheetsPage.infoSheetCodesStandardsTitle;
    case 'siteLocation':
      return t.sheetsPage.infoSheetSiteLocationTitle;
    case 'siteSurvey':
      return t.sheetsPage.infoSheetSiteSurveyTitle;
  }
}
