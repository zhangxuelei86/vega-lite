import {getPositionScaleChannel, getSizeType, POSITION_SCALE_CHANNELS} from '../../channel';
import {getViewConfigContinuousSize, getViewConfigDiscreteSize} from '../../config';
import {hasDiscreteDomain} from '../../scale';
import {isStep} from '../../spec/base';
import {isVgRangeStep} from '../../vega.schema';
import {ConcatModel} from '../concat';
import {Model} from '../model';
import {Explicit, mergeValuesWithExplicit} from '../split';
import {UnitModel} from '../unit';
import {getSizeTypeFromLayoutSizeType, LayoutSize, LayoutSizeIndex, LayoutSizeType} from './component';

export function parseLayerLayoutSize(model: Model) {
  parseChildrenLayoutSize(model);

  parseNonUnitLayoutSizeForChannel(model, 'width');
  parseNonUnitLayoutSizeForChannel(model, 'height');
}

export const parseRepeatLayoutSize = parseConcatLayoutSize;

export function parseConcatLayoutSize(model: ConcatModel) {
  parseChildrenLayoutSize(model);

  parseNonUnitLayoutSizeForChannel(model, 'childWidth');
  parseNonUnitLayoutSizeForChannel(model, 'childHeight');
}

export function parseChildrenLayoutSize(model: Model) {
  for (const child of model.children) {
    child.parseLayoutSize();
  }
}

/**
 * Merge child layout size (width or height).
 */
function parseNonUnitLayoutSizeForChannel(model: Model, layoutSizeType: LayoutSizeType) {
  /*
   * For concat, the parent width or height might not be the same as the children's shared height.
   * For example, hconcat's subviews may share width, but the shared width is not the hconcat view's width.
   *
   * layoutSizeType represents the output of the view (could be childWidth/childHeight/width/height)
   * while the sizeType represents the properties of the child.
   */
  const sizeType = getSizeTypeFromLayoutSizeType(layoutSizeType);
  const channel = getPositionScaleChannel(sizeType);
  const resolve = model.component.resolve;
  const layoutSizeCmpt = model.component.layoutSize;

  let mergedSize: Explicit<LayoutSize>;
  // Try to merge layout size
  for (const child of model.children) {
    const childSize = child.component.layoutSize.getWithExplicit(sizeType);
    const scaleResolve = resolve.scale[channel];
    if (scaleResolve === 'independent' && childSize.value === 'step') {
      // Do not merge independent scales with range-step as their size depends
      // on the scale domains, which can be different between scales.
      mergedSize = undefined;
      break;
    }

    if (mergedSize) {
      if (scaleResolve === 'independent' && mergedSize.value !== childSize.value) {
        // For independent scale, only merge if all the sizes are the same.
        // If the values are different, abandon the merge!
        mergedSize = undefined;
        break;
      }
      mergedSize = mergeValuesWithExplicit<LayoutSizeIndex, LayoutSize>(mergedSize, childSize, sizeType, '');
    } else {
      mergedSize = childSize;
    }
  }

  if (mergedSize) {
    // If merged, rename size and set size of all children.
    for (const child of model.children) {
      model.renameSignal(child.getName(sizeType), model.getName(layoutSizeType));
      child.component.layoutSize.set(sizeType, 'merged', false);
    }
    layoutSizeCmpt.setWithExplicit(layoutSizeType, mergedSize);
  } else {
    layoutSizeCmpt.setWithExplicit(layoutSizeType, {
      explicit: false,
      value: undefined
    });
  }
}

export function parseUnitLayoutSize(model: UnitModel) {
  const {size, component} = model;
  for (const channel of POSITION_SCALE_CHANNELS) {
    const sizeType = getSizeType(channel);

    if (size[sizeType]) {
      const specifiedSize = size[sizeType];
      component.layoutSize.set(sizeType, isStep(specifiedSize) ? 'step' : specifiedSize, true);
    } else {
      const defaultSize = defaultUnitSize(model, sizeType);
      component.layoutSize.set(sizeType, defaultSize, false);
    }
  }
}

function defaultUnitSize(model: UnitModel, sizeType: 'width' | 'height'): LayoutSize {
  const channel = sizeType === 'width' ? 'x' : 'y';
  const config = model.config;
  const scaleComponent = model.getScaleComponent(channel);

  if (scaleComponent) {
    const scaleType = scaleComponent.get('type');
    const range = scaleComponent.get('range');

    if (hasDiscreteDomain(scaleType)) {
      const size = getViewConfigDiscreteSize(config.view, sizeType);
      if (isVgRangeStep(range) || isStep(size)) {
        // For discrete domain with range.step, use dynamic width/height
        return 'step';
      } else {
        return size;
      }
    } else {
      return getViewConfigContinuousSize(config.view, sizeType);
    }
  } else if (model.hasProjection) {
    return getViewConfigContinuousSize(config.view, sizeType);
  } else {
    const size = getViewConfigDiscreteSize(config.view, sizeType);
    return isStep(size) ? size.step : size;
  }
}
