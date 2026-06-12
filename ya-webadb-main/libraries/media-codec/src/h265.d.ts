import { NaluSodbBitReader } from "./nalu.js";
/**
 * 6.2 Source, decoded and output picture formats
 */
export declare function getSubWidthC(chroma_format_idc: number): 1 | 2;
/**
 * 6.2 Source, decoded and output picture formats
 */
export declare function getSubHeightC(chroma_format_idc: number): 1 | 2;
/**
 * 7.3.1.1 General NAL unit syntax
 */
export declare function parseNaluHeader(nalu: Uint8Array): {
    nal_unit_type: number;
    nuh_layer_id: number;
    nuh_temporal_id_plus1: number;
};
export type NaluHeader = ReturnType<typeof parseNaluHeader>;
export interface NaluRaw extends NaluHeader {
    data: Uint8Array;
    rbsp: Uint8Array;
}
/**
 * 7.3.2.1 Video parameter set RBSP syntax
 */
export declare function parseVideoParameterSet(nalu: Uint8Array): {
    vps_video_parameter_set_id: number;
    vps_base_layer_internal_flag: boolean;
    vps_base_layer_available_flag: boolean;
    vps_max_layers_minus1: number;
    vps_max_sub_layers_minus1: number;
    vps_temporal_id_nesting_flag: boolean;
    profileTierLevel: ProfileTierLevel & {
        generalProfileTier: ProfileTier;
    };
    vps_sub_layer_ordering_info_present_flag: boolean;
    vps_max_dec_pic_buffering_minus1: number[];
    vps_max_num_reorder_pics: number[];
    vps_max_latency_increase_plus1: number[];
    vps_max_layer_id: number;
    vps_num_layer_sets_minus1: number;
    layer_id_included_flag: boolean[][];
    vps_timing_info_present_flag: boolean;
    vps_num_units_in_tick: number;
    vps_time_scale: number;
    vps_poc_proportional_to_timing_flag: boolean;
    vps_num_ticks_poc_diff_one_minus1: number;
    vps_num_hrd_parameters: number;
    hrd_layer_set_idx: number[];
    cprms_present_flag: boolean[];
    hrdParameters: {
        nal_hrd_parameters_present_flag: boolean;
        vcl_hrd_parameters_present_flag: boolean;
        sub_pic_hrd_params_present_flag: boolean;
        tick_divisor_minus2: number;
        du_cpb_removal_delay_increment_length_minus1: number;
        sub_pic_cpb_params_in_pic_timing_sei_flag: boolean;
        dpb_output_delay_du_length_minus1: number;
        bit_rate_scale: number;
        cpb_size_scale: number;
        cpb_size_du_scale: number;
        initial_cpb_removal_delay_length_minus1: number;
        au_cpb_removal_delay_length_minus1: number;
        dpb_output_delay_length_minus1: number;
        fixed_pic_rate_general_flag: boolean[];
        fixed_pic_rate_within_cvs_flag: boolean[];
        elemental_duration_in_tc_minus1: number[];
        low_delay_hrd_flag: boolean[];
        cpb_cnt_minus1: number[];
        nalHrdParameters: {
            bit_rate_value_minus1: number[];
            cpb_size_value_minus1: number[];
            cpb_size_du_value_minus1: number[];
            bit_rate_du_value_minus1: number[];
            cbr_flag: boolean[];
        }[];
        vclHrdParameters: {
            bit_rate_value_minus1: number[];
            cpb_size_value_minus1: number[];
            cpb_size_du_value_minus1: number[];
            bit_rate_du_value_minus1: number[];
            cbr_flag: boolean[];
        }[];
    }[];
    vps_extension_flag: boolean;
};
export type SubLayerHrdParameters = ReturnType<typeof parseSubLayerHrdParameters>;
/**
 * 7.3.2.2.1 General sequence parameter set RBSP syntax
 */
export declare function parseSequenceParameterSet(nalu: Uint8Array): {
    sps_video_parameter_set_id: number;
    sps_max_sub_layers_minus1: number;
    sps_temporal_id_nesting_flag: boolean;
    profileTierLevel: ProfileTierLevel & {
        generalProfileTier: ProfileTier;
    };
    sps_seq_parameter_set_id: number;
    chroma_format_idc: number;
    separate_colour_plane_flag: boolean;
    pic_width_in_luma_samples: number;
    pic_height_in_luma_samples: number;
    conformance_window_flag: boolean;
    conf_win_left_offset: number;
    conf_win_right_offset: number;
    conf_win_top_offset: number;
    conf_win_bottom_offset: number;
    bit_depth_luma_minus8: number;
    bit_depth_chroma_minus8: number;
    log2_max_pic_order_cnt_lsb_minus4: number;
    sps_sub_layer_ordering_info_present_flag: boolean;
    sps_max_dec_pic_buffering_minus1: number[];
    sps_max_num_reorder_pics: number[];
    sps_max_latency_increase_plus1: number[];
    log2_min_luma_coding_block_size_minus3: number;
    log2_diff_max_min_luma_coding_block_size: number;
    log2_min_luma_transform_block_size_minus2: number;
    log2_diff_max_min_luma_transform_block_size: number;
    max_transform_hierarchy_depth_inter: number;
    max_transform_hierarchy_depth_intra: number;
    scaling_list_enabled_flag: boolean;
    sps_scaling_list_data_present_flag: boolean;
    scalingListData: number[][][];
    amp_enabled_flag: boolean;
    sample_adaptive_offset_enabled_flag: boolean;
    pcm_enabled_flag: boolean;
    pcm_sample_bit_depth_luma_minus1: number;
    pcm_sample_bit_depth_chroma_minus1: number;
    log2_min_pcm_luma_coding_block_size_minus3: number;
    log2_diff_max_min_pcm_luma_coding_block_size: number;
    pcm_loop_filter_disabled_flag: boolean;
    num_short_term_ref_pic_sets: number;
    shortTermRefPicSets: ShortTermReferencePictureSet[];
    long_term_ref_pics_present_flag: boolean;
    num_long_term_ref_pics_sps: number;
    lt_ref_pic_poc_lsb_sps: number[];
    used_by_curr_pic_lt_sps_flag: boolean[];
    sps_temporal_mvp_enabled_flag: boolean;
    strong_intra_smoothing_enabled_flag: boolean;
    vui_parameters_present_flag: boolean;
    vuiParameters: {
        aspect_ratio_info_present_flag: boolean;
        aspect_ratio_idc: AspectRatioIndicator;
        sar_width: number;
        sar_height: number;
        overscan_info_present_flag: boolean;
        overscan_appropriate_flag: boolean;
        video_signal_type_present_flag: boolean;
        video_format: number;
        video_full_range_flag: boolean;
        colour_description_present_flag: boolean;
        colour_primaries: number;
        transfer_characteristics: number;
        matrix_coeffs: number;
        chroma_loc_info_present_flag: boolean;
        chroma_sample_loc_type_top_field: number;
        chroma_sample_loc_type_bottom_field: number;
        neutral_chroma_indication_flag: boolean;
        field_seq_flag: boolean;
        frame_field_info_present_flag: boolean;
        default_display_window_flag: boolean;
        def_disp_win_left_offset: number;
        def_disp_win_right_offset: number;
        def_disp_win_top_offset: number;
        def_disp_win_bottom_offset: number;
        vui_timing_info_present_flag: boolean;
        vui_num_units_in_tick: number;
        vui_time_scale: number;
        vui_poc_proportional_to_timing_flag: boolean;
        vui_num_ticks_poc_diff_one_minus1: number;
        vui_hrd_parameters_present_flag: boolean;
        vui_hrd_parameters: {
            nal_hrd_parameters_present_flag: boolean;
            vcl_hrd_parameters_present_flag: boolean;
            sub_pic_hrd_params_present_flag: boolean;
            tick_divisor_minus2: number;
            du_cpb_removal_delay_increment_length_minus1: number;
            sub_pic_cpb_params_in_pic_timing_sei_flag: boolean;
            dpb_output_delay_du_length_minus1: number;
            bit_rate_scale: number;
            cpb_size_scale: number;
            cpb_size_du_scale: number;
            initial_cpb_removal_delay_length_minus1: number;
            au_cpb_removal_delay_length_minus1: number;
            dpb_output_delay_length_minus1: number;
            fixed_pic_rate_general_flag: boolean[];
            fixed_pic_rate_within_cvs_flag: boolean[];
            elemental_duration_in_tc_minus1: number[];
            low_delay_hrd_flag: boolean[];
            cpb_cnt_minus1: number[];
            nalHrdParameters: {
                bit_rate_value_minus1: number[];
                cpb_size_value_minus1: number[];
                cpb_size_du_value_minus1: number[];
                bit_rate_du_value_minus1: number[];
                cbr_flag: boolean[];
            }[];
            vclHrdParameters: {
                bit_rate_value_minus1: number[];
                cpb_size_value_minus1: number[];
                cpb_size_du_value_minus1: number[];
                bit_rate_du_value_minus1: number[];
                cbr_flag: boolean[];
            }[];
        };
        bitstream_restriction_flag: boolean;
        tiles_fixed_structure_flag: boolean;
        motion_vectors_over_pic_boundaries_flag: boolean;
        restricted_ref_pic_lists_flag: boolean;
        min_spatial_segmentation_idc: number;
        max_bytes_per_pic_denom: number;
        max_bits_per_min_cu_denom: number;
        log2_max_mv_length_horizontal: number;
        log2_max_mv_length_vertical: number;
    };
    sps_extension_present_flag: boolean;
    sps_range_extension_flag: boolean;
    sps_multilayer_extension_flag: boolean;
    sps_3d_extension_flag: boolean;
    sps_scc_extension_flag: boolean;
    sps_extension_4bits: number;
    spsMultilayerExtension: {
        inter_view_mv_vert_constraint_flag: boolean;
    };
    sps3dExtension: {
        iv_di_mc_enabled_flag: boolean[];
        iv_mv_scal_enabled_flag: boolean[];
        log2_ivmc_sub_pb_size_minus3: number;
        iv_res_pred_enabled_flag: boolean;
        depth_ref_enabled_flag: boolean;
        vsp_mc_enabled_flag: boolean;
        dbbp_enabled_flag: boolean;
        tex_mc_enabled_flag: boolean;
        log2_texmc_sub_pb_size_minus3: number;
        intra_contour_enabled_flag: boolean;
        intra_dc_only_wedge_enabled_flag: boolean;
        cqt_cu_part_pred_enabled_flag: boolean;
        inter_dc_only_enabled_flag: boolean;
        skip_intra_enabled_flag: boolean;
    };
    sps_extension_data_flag: boolean[];
};
/**
 * 7.3.3 Profile, tier and level syntax
 *
 * Common part between general_profile_tier_level and
 * sub_layer_profile_tier_level
 */
declare function parseProfileTier(reader: NaluSodbBitReader): {
    profile_space: number;
    tier_flag: boolean;
    profile_idc: number;
    profileCompatibilitySet: Uint8Array<ArrayBufferLike>;
    profile_compatibility_flag: boolean[];
    constraintSet: Uint8Array<ArrayBufferLike>;
    progressive_source_flag: boolean;
    interlaced_source_flag: boolean;
    non_packed_constraint_flag: boolean;
    frame_only_constraint_flag: boolean;
    max_12bit_constraint_flag: boolean;
    max_10bit_constraint_flag: boolean;
    max_8bit_constraint_flag: boolean;
    max_422chroma_constraint_flag: boolean;
    max_420chroma_constraint_flag: boolean;
    max_monochrome_constraint_flag: boolean;
    intra_constraint_flag: boolean;
    one_picture_only_constraint_flag: boolean;
    lower_bit_rate_constraint_flag: boolean;
    max_14bit_constraint_flag: boolean;
    inbld_flag: boolean;
};
export type ProfileTier = ReturnType<typeof parseProfileTier>;
export interface ProfileTierLevel {
    generalProfileTier: ProfileTier | undefined;
    general_level_idc: number;
    sub_layer_profile_present_flag: boolean[];
    sub_layer_level_present_flag: boolean[];
    subLayerProfileTier: ProfileTier[];
    sub_layer_level_idc: number[];
}
/**
 * 7.3.4 Scaling list data syntax
 */
export declare function parseScalingListData(reader: NaluSodbBitReader): number[][][];
interface ShortTermReferencePictureSet {
    stRpsIdx: number;
    num_short_term_ref_pic_sets: number;
    inter_ref_pic_set_prediction_flag: boolean;
    delta_idx_minus1: number;
    delta_rps_sign: boolean;
    abs_delta_rps_minus1: number;
    used_by_curr_pic_flag: boolean[];
    use_delta_flag: boolean[];
    num_negative_pics: number;
    num_positive_pics: number;
    delta_poc_s0_minus1: number[];
    used_by_curr_pic_s0_flag: boolean[];
    delta_poc_s1_minus1: number[];
    used_by_curr_pic_s1_flag: boolean[];
}
/**
 * 7.3.7 Short-term reference picture set syntax
 */
export declare function parseShortTermReferencePictureSet(reader: NaluSodbBitReader, stRpsIdx: number, num_short_term_ref_pic_sets: number, sets: ShortTermReferencePictureSet[]): ShortTermReferencePictureSet;
export declare const AspectRatioIndicator: {
    readonly Unspecified: 0;
    readonly Square: 1;
    readonly "12:11": 2;
    readonly "10:11": 3;
    readonly "16:11": 4;
    readonly "40:33": 5;
    readonly "24:11": 6;
    readonly "20:11": 7;
    readonly "32:11": 8;
    readonly "80:33": 9;
    readonly "18:11": 10;
    readonly "15:11": 11;
    readonly "64:33": 12;
    readonly "160:99": 13;
    readonly "4:3": 15;
    readonly "3:2": 16;
    readonly "2:1": 17;
    readonly Extended: 255;
};
export type AspectRatioIndicator = (typeof AspectRatioIndicator)[keyof typeof AspectRatioIndicator];
/**
 * E.2.1 VUI parameters syntax
 */
export declare function parseVuiParameters(reader: NaluSodbBitReader, sps_max_sub_layers_minus1: number): {
    aspect_ratio_info_present_flag: boolean;
    aspect_ratio_idc: AspectRatioIndicator;
    sar_width: number;
    sar_height: number;
    overscan_info_present_flag: boolean;
    overscan_appropriate_flag: boolean;
    video_signal_type_present_flag: boolean;
    video_format: number;
    video_full_range_flag: boolean;
    colour_description_present_flag: boolean;
    colour_primaries: number;
    transfer_characteristics: number;
    matrix_coeffs: number;
    chroma_loc_info_present_flag: boolean;
    chroma_sample_loc_type_top_field: number;
    chroma_sample_loc_type_bottom_field: number;
    neutral_chroma_indication_flag: boolean;
    field_seq_flag: boolean;
    frame_field_info_present_flag: boolean;
    default_display_window_flag: boolean;
    def_disp_win_left_offset: number;
    def_disp_win_right_offset: number;
    def_disp_win_top_offset: number;
    def_disp_win_bottom_offset: number;
    vui_timing_info_present_flag: boolean;
    vui_num_units_in_tick: number;
    vui_time_scale: number;
    vui_poc_proportional_to_timing_flag: boolean;
    vui_num_ticks_poc_diff_one_minus1: number;
    vui_hrd_parameters_present_flag: boolean;
    vui_hrd_parameters: {
        nal_hrd_parameters_present_flag: boolean;
        vcl_hrd_parameters_present_flag: boolean;
        sub_pic_hrd_params_present_flag: boolean;
        tick_divisor_minus2: number;
        du_cpb_removal_delay_increment_length_minus1: number;
        sub_pic_cpb_params_in_pic_timing_sei_flag: boolean;
        dpb_output_delay_du_length_minus1: number;
        bit_rate_scale: number;
        cpb_size_scale: number;
        cpb_size_du_scale: number;
        initial_cpb_removal_delay_length_minus1: number;
        au_cpb_removal_delay_length_minus1: number;
        dpb_output_delay_length_minus1: number;
        fixed_pic_rate_general_flag: boolean[];
        fixed_pic_rate_within_cvs_flag: boolean[];
        elemental_duration_in_tc_minus1: number[];
        low_delay_hrd_flag: boolean[];
        cpb_cnt_minus1: number[];
        nalHrdParameters: {
            bit_rate_value_minus1: number[];
            cpb_size_value_minus1: number[];
            cpb_size_du_value_minus1: number[];
            bit_rate_du_value_minus1: number[];
            cbr_flag: boolean[];
        }[];
        vclHrdParameters: {
            bit_rate_value_minus1: number[];
            cpb_size_value_minus1: number[];
            cpb_size_du_value_minus1: number[];
            bit_rate_du_value_minus1: number[];
            cbr_flag: boolean[];
        }[];
    };
    bitstream_restriction_flag: boolean;
    tiles_fixed_structure_flag: boolean;
    motion_vectors_over_pic_boundaries_flag: boolean;
    restricted_ref_pic_lists_flag: boolean;
    min_spatial_segmentation_idc: number;
    max_bytes_per_pic_denom: number;
    max_bits_per_min_cu_denom: number;
    log2_max_mv_length_horizontal: number;
    log2_max_mv_length_vertical: number;
};
export type VuiParameters = ReturnType<typeof parseVuiParameters>;
/**
 * E.2.2 HRD parameters syntax
 */
export declare function parseHrdParameters(reader: NaluSodbBitReader, commonInfPresentFlag: boolean, maxNumSubLayersMinus1: number): {
    nal_hrd_parameters_present_flag: boolean;
    vcl_hrd_parameters_present_flag: boolean;
    sub_pic_hrd_params_present_flag: boolean;
    tick_divisor_minus2: number;
    du_cpb_removal_delay_increment_length_minus1: number;
    sub_pic_cpb_params_in_pic_timing_sei_flag: boolean;
    dpb_output_delay_du_length_minus1: number;
    bit_rate_scale: number;
    cpb_size_scale: number;
    cpb_size_du_scale: number;
    initial_cpb_removal_delay_length_minus1: number;
    au_cpb_removal_delay_length_minus1: number;
    dpb_output_delay_length_minus1: number;
    fixed_pic_rate_general_flag: boolean[];
    fixed_pic_rate_within_cvs_flag: boolean[];
    elemental_duration_in_tc_minus1: number[];
    low_delay_hrd_flag: boolean[];
    cpb_cnt_minus1: number[];
    nalHrdParameters: {
        bit_rate_value_minus1: number[];
        cpb_size_value_minus1: number[];
        cpb_size_du_value_minus1: number[];
        bit_rate_du_value_minus1: number[];
        cbr_flag: boolean[];
    }[];
    vclHrdParameters: {
        bit_rate_value_minus1: number[];
        cpb_size_value_minus1: number[];
        cpb_size_du_value_minus1: number[];
        bit_rate_du_value_minus1: number[];
        cbr_flag: boolean[];
    }[];
};
export type HrdParameters = ReturnType<typeof parseHrdParameters>;
/**
 * E.2.3 Sub-layer HRD parameters syntax
 */
export declare function parseSubLayerHrdParameters(reader: NaluSodbBitReader, subLayerId: number, CpbCnt: number): {
    bit_rate_value_minus1: number[];
    cpb_size_value_minus1: number[];
    cpb_size_du_value_minus1: number[];
    bit_rate_du_value_minus1: number[];
    cbr_flag: boolean[];
};
export declare function searchConfiguration(buffer: Uint8Array): {
    videoParameterSet: NaluRaw;
    sequenceParameterSet: NaluRaw;
    pictureParameterSet: NaluRaw;
};
export declare function parseSpsMultilayerExtension(reader: NaluSodbBitReader): {
    inter_view_mv_vert_constraint_flag: boolean;
};
export type SpsMultilayerExtension = ReturnType<typeof parseSpsMultilayerExtension>;
export declare function parseSps3dExtension(reader: NaluSodbBitReader): {
    iv_di_mc_enabled_flag: boolean[];
    iv_mv_scal_enabled_flag: boolean[];
    log2_ivmc_sub_pb_size_minus3: number;
    iv_res_pred_enabled_flag: boolean;
    depth_ref_enabled_flag: boolean;
    vsp_mc_enabled_flag: boolean;
    dbbp_enabled_flag: boolean;
    tex_mc_enabled_flag: boolean;
    log2_texmc_sub_pb_size_minus3: number;
    intra_contour_enabled_flag: boolean;
    intra_dc_only_wedge_enabled_flag: boolean;
    cqt_cu_part_pred_enabled_flag: boolean;
    inter_dc_only_enabled_flag: boolean;
    skip_intra_enabled_flag: boolean;
};
export type Sps3dExtension = ReturnType<typeof parseSps3dExtension>;
export interface Configuration {
    videoParameterSet: NaluRaw;
    sequenceParameterSet: NaluRaw;
    pictureParameterSet: NaluRaw;
    generalProfileSpace: number;
    generalProfileIndex: number;
    generalProfileCompatibilitySet: Uint8Array;
    generalTierFlag: boolean;
    generalLevelIndex: number;
    generalConstraintSet: Uint8Array;
    encodedWidth: number;
    encodedHeight: number;
    cropLeft: number;
    cropRight: number;
    cropTop: number;
    cropBottom: number;
    croppedWidth: number;
    croppedHeight: number;
}
export declare function parseConfiguration(data: Uint8Array): Configuration;
export declare function toCodecString(configuration: Configuration): string;
export {};
//# sourceMappingURL=h265.d.ts.map