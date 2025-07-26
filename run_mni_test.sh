#!/bin/bash
# Run the MNI test

cd core/neuro-integration-tests

# Run the test file that has a main function
if [ -f tests/test_mni_declarative.rs ]; then
    echo "Running test_mni_declarative.rs..."
    rustc --edition 2021 tests/test_mni_declarative.rs \
        -L target/debug/deps \
        -L ../render_loop/target/debug/deps \
        -L ../neuro-types/target/debug/deps \
        -L ../nifti-loader/target/debug/deps \
        -L ../volmath/target/debug/deps \
        -L ../bridge_types/target/debug/deps \
        --extern neuro_integration_tests=target/debug/libneuro_integration_tests.rlib \
        --extern render_loop=../render_loop/target/debug/librender_loop.rlib \
        --extern neuro_types=../neuro-types/target/debug/libneuro_types.rlib \
        --extern nifti_loader=../loaders/nifti/target/debug/libnifti_loader.rlib \
        --extern volmath=../volmath/target/debug/libvolmath.rlib \
        --extern bridge_types=../bridge_types/target/debug/libbridge_types.rlib \
        --extern tokio=target/debug/deps/libtokio-*.rlib \
        --extern image=target/debug/deps/libimage-*.rlib \
        --extern wgpu=target/debug/deps/libwgpu-*.rlib \
        -o test_mni_declarative_runner \
        && ./test_mni_declarative_runner
else
    echo "test_mni_declarative.rs not found!"
fi